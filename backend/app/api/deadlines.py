from datetime import UTC, datetime
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import CurrentActor, StaffActor
from app.db.session import get_db_session
from app.db.tables import deadline_table, student_table
from app.schemas.deadlines import CreateDeadlineRequest, DeadlineSummary
from app.services.commands.base import (
    CommandContext,
    execute_command,
    require_idempotency_key,
)
from app.services.commands.deadlines import create_deadline_command

router = APIRouter(tags=["deadlines"])
DbSession = Annotated[AsyncSession, Depends(get_db_session)]


async def _student_for_actor(actor: CurrentActor, db: AsyncSession, student_id: str):
    row = (
        (
            await db.execute(
                select(
                    student_table.c.id,
                    student_table.c.curatorId,
                    student_table.c.userId,
                    student_table.c.firstName,
                    student_table.c.lastName,
                ).where(student_table.c.id == student_id)
            )
        )
        .mappings()
        .first()
    )
    if row is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Student not found")
    if actor.role == "STUDENT" and row.userId != actor.id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Student access denied")
    if actor.role == "CURATOR" and row.curatorId not in {actor.id, None}:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Student access denied")
    return row


@router.get("/deadlines", response_model=list[DeadlineSummary])
async def list_deadlines(
    actor: CurrentActor,
    db: DbSession,
    days: Annotated[int | None, Query(ge=1, le=365)] = None,
) -> list[DeadlineSummary]:
    statement = (
        select(deadline_table, student_table.c.firstName, student_table.c.lastName)
        .join(student_table, student_table.c.id == deadline_table.c.studentId)
        .where(
            deadline_table.c.date
            >= datetime.now(UTC).replace(hour=0, minute=0, second=0, microsecond=0)
        )
        .order_by(deadline_table.c.date)
    )
    if actor.role == "STUDENT":
        statement = statement.where(
            student_table.c.userId == actor.id, deadline_table.c.isInternal.is_(False)
        )
    elif actor.role == "CURATOR":
        statement = statement.where(student_table.c.curatorId == actor.id)
    if days is not None:
        from datetime import timedelta

        statement = statement.where(
            deadline_table.c.date < datetime.now(UTC) + timedelta(days=days + 1)
        )
    rows = (await db.execute(statement)).mappings()
    return [
        DeadlineSummary(
            id=row.id,
            title=row.title,
            date=row.date,
            type=row.type,
            student_id=row.studentId,
            application_id=row.applicationId,
            is_hard_deadline=row.isHardDeadline,
            is_internal=row.isInternal,
            risk_weight=row.riskWeight,
            student_name=f"{row.firstName} {row.lastName}",
        )
        for row in rows
    ]


@router.post("/deadlines", response_model=DeadlineSummary, status_code=status.HTTP_201_CREATED)
async def create_deadline(
    actor: StaffActor,
    db: DbSession,
    request: CreateDeadlineRequest,
    idempotency_key: Annotated[str, Depends(require_idempotency_key)],
) -> DeadlineSummary:
    student = await _student_for_actor(actor, db, request.student_id)
    await db.rollback()
    async with db.begin():
        context = CommandContext(
            principal_id=actor.id,
            operation="deadline.create",
            idempotency_key=idempotency_key,
            correlation_id=idempotency_key,
            actor_type="USER",
            actor_id=actor.id,
        )
        executed = await execute_command(
            db,
            context=context,
            payload=request.model_dump(mode="json"),
            handler=lambda command: create_deadline_command(
                db,
                context=command,
                request=request,
                student_name=f"{student.firstName} {student.lastName}",
            ),
        )
    return DeadlineSummary.model_validate(executed.result.response)
