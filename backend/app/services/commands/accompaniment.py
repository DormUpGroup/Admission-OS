import json
from datetime import UTC, datetime
from typing import Any
from uuid import uuid4

from fastapi import HTTPException, status
from sqlalchemy import func, insert, or_, select, update
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.tables import activity_table, intake_cohort_table, student_table
from app.events.records import append_audit, append_outbox
from app.services.commands.base import CommandContext, CommandResult
from app.services.operations.accompaniment import (
    can_accept_to_cohort,
    intake_aliases,
    normalize_intake_key,
)
from app.services.operations.recalculate import recalculate_student


async def _read_student(db: AsyncSession, student_id: str) -> dict[str, Any]:
    student = (
        await db.execute(select(student_table).where(student_table.c.id == student_id))
    ).mappings().first()
    if student is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Student not found"
        )
    return dict(student)


async def _locked_student(db: AsyncSession, student_id: str) -> dict[str, Any]:
    student = (
        await db.execute(
            select(student_table)
            .where(student_table.c.id == student_id)
            .with_for_update()
        )
    ).mappings().first()
    if student is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Student not found"
        )
    return dict(student)


async def _ensure_cohort(db: AsyncSession, intake: str, now: datetime) -> dict[str, Any]:
    key = normalize_intake_key(intake)
    if not key:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="Не указан набор",
        )
    dialect = db.bind.dialect.name if db.bind is not None else ""
    cohort_id = uuid4().hex
    if dialect == "postgresql":
        statement = (
            pg_insert(intake_cohort_table)
            .values(
                id=cohort_id,
                intake=key,
                seatLimit=None,
                isActive=False,
                version=1,
                createdAt=now,
                updatedAt=now,
            )
            .on_conflict_do_update(
                index_elements=[intake_cohort_table.c.intake],
                set_={"updatedAt": now},
            )
            .returning(intake_cohort_table)
        )
        row = (await db.execute(statement)).mappings().first()
        assert row is not None
        locked = (
            await db.execute(
                select(intake_cohort_table)
                .where(intake_cohort_table.c.id == row.id)
                .with_for_update()
            )
        ).mappings().one()
        return dict(locked)

    existing = (
        await db.execute(
            select(intake_cohort_table)
            .where(intake_cohort_table.c.intake == key)
            .with_for_update()
        )
    ).mappings().first()
    if existing:
        await db.execute(
            update(intake_cohort_table)
            .where(intake_cohort_table.c.id == existing.id)
            .values(updatedAt=now)
        )
        return dict(existing)
    try:
        async with db.begin_nested():
            await db.execute(
                insert(intake_cohort_table).values(
                    id=cohort_id,
                    intake=key,
                    seatLimit=None,
                    isActive=False,
                    version=1,
                    createdAt=now,
                    updatedAt=now,
                )
            )
    except IntegrityError:
        existing = (
            await db.execute(
                select(intake_cohort_table)
                .where(intake_cohort_table.c.intake == key)
                .with_for_update()
            )
        ).mappings().one()
        return dict(existing)
    locked = (
        await db.execute(
            select(intake_cohort_table)
            .where(intake_cohort_table.c.id == cohort_id)
            .with_for_update()
        )
    ).mappings().one()
    return dict(locked)


async def count_occupied_seats(db: AsyncSession, intake: str) -> int:
    aliases = intake_aliases(intake)
    occupied_query = select(func.count()).select_from(student_table).where(
        student_table.c.accompanimentStatus == "ACCEPTED"
    )
    if aliases:
        occupied_query = occupied_query.where(
            or_(*[student_table.c.intake == alias for alias in aliases])
        )
    else:
        occupied_query = occupied_query.where(student_table.c.intake == intake)
    return (await db.execute(occupied_query)).scalar_one()


async def accept_accompaniment_command(
    db: AsyncSession,
    *,
    context: CommandContext,
    student_id: str,
) -> CommandResult:
    now = datetime.now(UTC)
    preview = await _read_student(db, student_id)
    if preview["status"] == "ARCHIVED":
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Нельзя принять ученика из архива",
        )
    if preview["accompanimentStatus"] == "ACCEPTED":
        return CommandResult(
            response={"id": student_id, "already_accepted": True, "status": "ACCEPTED"},
            entity_type="Student",
            entity_id=student_id,
        )
    cohort = await _ensure_cohort(db, preview["intake"], now)
    student = await _locked_student(db, student_id)
    if student["status"] == "ARCHIVED":
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Нельзя принять ученика из архива",
        )
    if student["accompanimentStatus"] == "ACCEPTED":
        return CommandResult(
            response={"id": student_id, "already_accepted": True, "status": "ACCEPTED"},
            entity_type="Student",
            entity_id=student_id,
        )
    occupied = await count_occupied_seats(db, student["intake"])
    ok, reason = can_accept_to_cohort(occupied, cohort.get("seatLimit"))
    if not ok:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=reason)
    curator_id = student["curatorId"] or context.actor_id
    await db.execute(
        update(student_table)
        .where(student_table.c.id == student_id)
        .values(
            accompanimentStatus="ACCEPTED",
            acceptedAt=now,
            acceptedById=context.actor_id,
            curatorId=curator_id,
            version=student_table.c.version + 1,
            updatedAt=now,
        )
    )
    await db.execute(
        update(intake_cohort_table)
        .where(intake_cohort_table.c.id == cohort["id"])
        .values(version=intake_cohort_table.c.version + 1, updatedAt=now)
    )
    await db.execute(
        insert(activity_table).values(
            id=uuid4().hex,
            type="ACCOMPANIMENT_ACCEPTED",
            studentId=student_id,
            userId=context.actor_id,
            metadata=json.dumps(
                {
                    "intake": student["intake"],
                    "note": "Принят на сопровождение",
                    "source": "python-command",
                },
                ensure_ascii=False,
            ),
            createdAt=now,
        )
    )
    await append_audit(
        db,
        actor_type=context.actor_type,
        actor_id=context.actor_id,
        user_id=context.actor_id,
        action="accompaniment.accept",
        entity_type="Student",
        entity_id=student_id,
        correlation_id=context.correlation_id,
        before={"accompanimentStatus": student["accompanimentStatus"]},
        after={"accompanimentStatus": "ACCEPTED", "curatorId": curator_id},
        now=now,
    )
    await append_outbox(
        db,
        aggregate_type="Student",
        aggregate_id=student_id,
        event_type="student.accompaniment_accepted.v1",
        payload={"student_id": student_id},
        idempotency_key=f"accompaniment:accept:{context.idempotency_key}",
        now=now,
    )
    await recalculate_student(db, student_id, now)
    occupied_after = occupied + 1
    if cohort.get("seatLimit") is not None and occupied_after > cohort["seatLimit"]:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="Мест в наборе нет"
        )
    return CommandResult(
        response={
            "id": student_id,
            "already_accepted": False,
            "status": "ACCEPTED",
        },
        entity_type="Student",
        entity_id=student_id,
    )


async def request_accompaniment_clarification_command(
    db: AsyncSession,
    *,
    context: CommandContext,
    student_id: str,
    note: str | None,
) -> CommandResult:
    now = datetime.now(UTC)
    student = await _locked_student(db, student_id)
    if student["accompanimentStatus"] == "ACCEPTED":
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Ученик уже принят на сопровождение",
        )
    note_text = (note or "").strip() or "Запрошено уточнение по анкете"
    await db.execute(
        update(student_table)
        .where(student_table.c.id == student_id)
        .values(
            accompanimentStatus="UNDER_REVIEW",
            version=student_table.c.version + 1,
            updatedAt=now,
        )
    )
    await db.execute(
        insert(activity_table).values(
            id=uuid4().hex,
            type="ACCOMPANIMENT_CLARIFICATION_REQUESTED",
            studentId=student_id,
            userId=context.actor_id,
            metadata=json.dumps(
                {"note": note_text, "source": "python-command"},
                ensure_ascii=False,
            ),
            createdAt=now,
        )
    )
    await append_audit(
        db,
        actor_type=context.actor_type,
        actor_id=context.actor_id,
        user_id=context.actor_id,
        action="accompaniment.request_clarification",
        entity_type="Student",
        entity_id=student_id,
        correlation_id=context.correlation_id,
        before={"accompanimentStatus": student["accompanimentStatus"]},
        after={"accompanimentStatus": "UNDER_REVIEW"},
        now=now,
    )
    await append_outbox(
        db,
        aggregate_type="Student",
        aggregate_id=student_id,
        event_type="student.accompaniment_clarification.v1",
        payload={"student_id": student_id},
        idempotency_key=f"accompaniment:clarify:{context.idempotency_key}",
        now=now,
    )
    return CommandResult(
        response={"id": student_id, "status": "UNDER_REVIEW"},
        entity_type="Student",
        entity_id=student_id,
    )


async def reject_accompaniment_command(
    db: AsyncSession,
    *,
    context: CommandContext,
    student_id: str,
    note: str | None = None,
) -> CommandResult:
    now = datetime.now(UTC)
    preview = await _read_student(db, student_id)
    frees_seat = preview["accompanimentStatus"] == "ACCEPTED"
    if frees_seat:
        await _ensure_cohort(db, preview["intake"], now)
    student = await _locked_student(db, student_id)
    note_text = (note or "").strip() or "Не принят на сопровождение"
    await db.execute(
        update(student_table)
        .where(student_table.c.id == student_id)
        .values(
            accompanimentStatus="REJECTED",
            acceptedAt=None,
            acceptedById=None,
            version=student_table.c.version + 1,
            updatedAt=now,
        )
    )
    if frees_seat or student["accompanimentStatus"] == "ACCEPTED":
        cohort = await _ensure_cohort(db, student["intake"], now)
        await db.execute(
            update(intake_cohort_table)
            .where(intake_cohort_table.c.id == cohort["id"])
            .values(version=intake_cohort_table.c.version + 1, updatedAt=now)
        )
    await db.execute(
        insert(activity_table).values(
            id=uuid4().hex,
            type="ACCOMPANIMENT_REJECTED",
            studentId=student_id,
            userId=context.actor_id,
            metadata=json.dumps(
                {"note": note_text, "source": "python-command"},
                ensure_ascii=False,
            ),
            createdAt=now,
        )
    )
    await append_audit(
        db,
        actor_type=context.actor_type,
        actor_id=context.actor_id,
        user_id=context.actor_id,
        action="accompaniment.reject",
        entity_type="Student",
        entity_id=student_id,
        correlation_id=context.correlation_id,
        before={"accompanimentStatus": student["accompanimentStatus"]},
        after={"accompanimentStatus": "REJECTED"},
        now=now,
    )
    await append_outbox(
        db,
        aggregate_type="Student",
        aggregate_id=student_id,
        event_type="student.accompaniment_rejected.v1",
        payload={"student_id": student_id},
        idempotency_key=f"accompaniment:reject:{context.idempotency_key}",
        now=now,
    )
    return CommandResult(
        response={"id": student_id, "status": "REJECTED"},
        entity_type="Student",
        entity_id=student_id,
    )


async def set_intake_seat_limit_command(
    db: AsyncSession,
    *,
    context: CommandContext,
    intake: str,
    seat_limit: int | None,
    is_active: bool | None,
) -> CommandResult:
    now = datetime.now(UTC)
    key = normalize_intake_key(intake)
    if not key:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="Не указан набор",
        )
    if seat_limit is not None and seat_limit < 0:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="Лимит должен быть неотрицательным числом",
        )
    if is_active:
        await db.execute(
            update(intake_cohort_table).values(isActive=False, updatedAt=now)
        )
    cohort = await _ensure_cohort(db, key, now)
    next_active = cohort["isActive"] if is_active is None else is_active
    await db.execute(
        update(intake_cohort_table)
        .where(intake_cohort_table.c.id == cohort["id"])
        .values(
            seatLimit=seat_limit,
            isActive=next_active,
            version=intake_cohort_table.c.version + 1,
            updatedAt=now,
        )
    )
    await append_audit(
        db,
        actor_type=context.actor_type,
        actor_id=context.actor_id,
        user_id=context.actor_id,
        action="intake_cohort.set_limit",
        entity_type="IntakeCohort",
        entity_id=cohort["id"],
        correlation_id=context.correlation_id,
        after={"intake": key, "seatLimit": seat_limit, "isActive": next_active},
        now=now,
    )
    await append_outbox(
        db,
        aggregate_type="IntakeCohort",
        aggregate_id=cohort["id"],
        event_type="intake_cohort.updated.v1",
        payload={"cohort_id": cohort["id"], "intake": key},
        idempotency_key=f"intake:limit:{context.idempotency_key}",
        now=now,
    )
    return CommandResult(
        response={
            "id": cohort["id"],
            "intake": key,
            "seat_limit": seat_limit,
            "is_active": next_active,
            "version": int(cohort.get("version") or 1) + 1,
        },
        entity_type="IntakeCohort",
        entity_id=cohort["id"],
    )
