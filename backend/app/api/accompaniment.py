from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import Actor, StaffActor
from app.db.session import get_db_session
from app.db.tables import student_table
from app.schemas.accompaniment import AccompanimentNoteRequest, IntakeSeatLimitRequest
from app.services.commands.accompaniment import (
    accept_accompaniment_command,
    reject_accompaniment_command,
    request_accompaniment_clarification_command,
    set_intake_seat_limit_command,
)
from app.services.commands.base import (
    CommandContext,
    execute_command,
    require_idempotency_key,
)

router = APIRouter(tags=["accompaniment"])
DbSession = Annotated[AsyncSession, Depends(get_db_session)]


def _require_admin(actor: Actor) -> None:
    if actor.role != "ADMIN":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, detail="Admin access required"
        )


async def _student_for_staff(actor: Actor, db: AsyncSession, student_id: str):
    row = (
        await db.execute(select(student_table).where(student_table.c.id == student_id))
    ).mappings().first()
    if row is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Student not found")
    if actor.role == "CURATOR" and row.curatorId not in {actor.id, None}:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Student access denied")
    return row


@router.post("/students/{student_id}/accompaniment/accept")
async def accept_accompaniment(
    actor: StaffActor,
    db: DbSession,
    student_id: str,
    idempotency_key: Annotated[str, Depends(require_idempotency_key)],
) -> dict[str, object]:
    await _student_for_staff(actor, db, student_id)
    await db.rollback()
    async with db.begin():
        executed = await execute_command(
            db,
            context=CommandContext(
                principal_id=actor.id,
                operation="accompaniment.accept",
                idempotency_key=idempotency_key,
                correlation_id=idempotency_key,
                actor_type="USER",
                actor_id=actor.id,
            ),
            payload={"student_id": student_id},
            handler=lambda command: accept_accompaniment_command(
                db, context=command, student_id=student_id
            ),
        )
    return executed.result.response


@router.post("/students/{student_id}/accompaniment/clarification")
async def request_clarification(
    actor: StaffActor,
    db: DbSession,
    student_id: str,
    request: AccompanimentNoteRequest,
    idempotency_key: Annotated[str, Depends(require_idempotency_key)],
) -> dict[str, object]:
    await _student_for_staff(actor, db, student_id)
    await db.rollback()
    async with db.begin():
        executed = await execute_command(
            db,
            context=CommandContext(
                principal_id=actor.id,
                operation="accompaniment.request_clarification",
                idempotency_key=idempotency_key,
                correlation_id=idempotency_key,
                actor_type="USER",
                actor_id=actor.id,
            ),
            payload={"student_id": student_id, **request.model_dump(mode="json")},
            handler=lambda command: request_accompaniment_clarification_command(
                db, context=command, student_id=student_id, note=request.note
            ),
        )
    return executed.result.response


@router.post("/students/{student_id}/accompaniment/reject")
async def reject_accompaniment(
    actor: StaffActor,
    db: DbSession,
    student_id: str,
    request: AccompanimentNoteRequest,
    idempotency_key: Annotated[str, Depends(require_idempotency_key)],
) -> dict[str, object]:
    _require_admin(actor)
    await _student_for_staff(actor, db, student_id)
    await db.rollback()
    async with db.begin():
        executed = await execute_command(
            db,
            context=CommandContext(
                principal_id=actor.id,
                operation="accompaniment.reject",
                idempotency_key=idempotency_key,
                correlation_id=idempotency_key,
                actor_type="USER",
                actor_id=actor.id,
            ),
            payload={"student_id": student_id, **request.model_dump(mode="json")},
            handler=lambda command: reject_accompaniment_command(
                db, context=command, student_id=student_id, note=request.note
            ),
        )
    return executed.result.response


@router.put("/intake-cohorts/seat-limit")
async def set_intake_seat_limit(
    actor: StaffActor,
    db: DbSession,
    request: IntakeSeatLimitRequest,
    idempotency_key: Annotated[str, Depends(require_idempotency_key)],
) -> dict[str, object]:
    _require_admin(actor)
    await db.rollback()
    async with db.begin():
        executed = await execute_command(
            db,
            context=CommandContext(
                principal_id=actor.id,
                operation="intake_cohort.set_limit",
                idempotency_key=idempotency_key,
                correlation_id=idempotency_key,
                actor_type="USER",
                actor_id=actor.id,
            ),
            payload=request.model_dump(mode="json"),
            handler=lambda command: set_intake_seat_limit_command(
                db,
                context=command,
                intake=request.intake,
                seat_limit=request.seat_limit,
                is_active=request.is_active,
            ),
        )
    return executed.result.response
