from datetime import UTC, datetime

from fastapi import HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.events.records import append_audit, append_outbox
from app.services.commands.base import CommandContext, CommandResult
from app.services.operations.recalculate import recalculate_student


async def recalculate_student_command(
    db: AsyncSession,
    *,
    context: CommandContext,
    student_id: str,
) -> CommandResult:
    now = datetime.now(UTC)
    result = await recalculate_student(db, student_id, now)
    if result is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Student not found"
        )
    await append_audit(
        db,
        actor_type=context.actor_type,
        actor_id=context.actor_id,
        user_id=context.actor_id,
        action="student.recalculate",
        entity_type="Student",
        entity_id=student_id,
        correlation_id=context.correlation_id,
        after=result,
        now=now,
    )
    await append_outbox(
        db,
        aggregate_type="Student",
        aggregate_id=student_id,
        event_type="case.recalculated.v1",
        payload={"student_id": student_id},
        idempotency_key=f"student:recalculate:{context.idempotency_key}",
        now=now,
    )
    return CommandResult(
        response=result,
        entity_type="Student",
        entity_id=student_id,
    )
