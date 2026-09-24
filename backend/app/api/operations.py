from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import StaffActor
from app.db.session import get_db_session
from app.db.tables import student_table
from app.schemas.operations import RecalculatePreview, RecalculatePreviewRequest
from app.services.commands.base import (
    CommandContext,
    execute_command,
    require_idempotency_key,
)
from app.services.commands.operations import recalculate_student_command
from app.services.operations.readiness import calculate_readiness
from app.services.operations.risk import calculate_application_risk

router = APIRouter(tags=["operations"])
DbSession = Annotated[AsyncSession, Depends(get_db_session)]


@router.post("/operations/recalculate-preview", response_model=RecalculatePreview)
async def recalculate_preview(
    _: StaffActor, request: RecalculatePreviewRequest
) -> RecalculatePreview:
    requirements = [(item.status, item.is_critical) for item in request.requirements]
    return RecalculatePreview(
        readiness_percent=calculate_readiness(status for status, _ in requirements),
        risk_level=calculate_application_risk(
            request.application_status,
            requirements,
            request.hard_deadline,
            request.waiting_days_max,
            request.has_overdue_urgent,
        ),
    )


@router.post("/students/{student_id}/recalculate")
async def persist_student_recalculation(
    actor: StaffActor,
    student_id: str,
    db: DbSession,
    idempotency_key: Annotated[str, Depends(require_idempotency_key)],
) -> dict:
    student = (
        await db.execute(
            select(student_table.c.id, student_table.c.curatorId).where(
                student_table.c.id == student_id
            )
        )
    ).mappings().first()
    if student is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Student not found"
        )
    if actor.role == "CURATOR" and student.curatorId not in {actor.id, None}:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, detail="Student access denied"
        )
    await db.rollback()
    async with db.begin():
        context = CommandContext(
            principal_id=actor.id,
            operation="student.recalculate",
            idempotency_key=idempotency_key,
            correlation_id=idempotency_key,
            actor_type="USER",
            actor_id=actor.id,
        )
        executed = await execute_command(
            db,
            context=context,
            payload={"student_id": student_id},
            handler=lambda command: recalculate_student_command(
                db, context=command, student_id=student_id
            ),
        )
    return executed.result.response
