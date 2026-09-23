from datetime import UTC, datetime
from uuid import uuid4

from fastapi import status
from sqlalchemy import insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.tables import activity_table, deadline_table
from app.events.records import append_audit, append_outbox
from app.schemas.deadlines import CreateDeadlineRequest
from app.services.commands.base import CommandContext, CommandResult
from app.services.operations.recalculate import recalculate_student


async def create_deadline_command(
    db: AsyncSession,
    *,
    context: CommandContext,
    request: CreateDeadlineRequest,
    student_name: str,
) -> CommandResult:
    deadline_id = uuid4().hex
    now = datetime.now(UTC)
    title = request.title.strip()
    await db.execute(
        insert(deadline_table).values(
            id=deadline_id,
            title=title,
            date=request.date,
            type=request.type,
            studentId=request.student_id,
            applicationId=request.application_id,
            requirementId=request.requirement_id,
            taskId=request.task_id,
            isHardDeadline=request.is_hard_deadline,
            isInternal=request.is_internal,
            riskWeight=request.risk_weight,
            createdAt=now,
            updatedAt=now,
        )
    )
    await db.execute(
        insert(activity_table).values(
            id=uuid4().hex,
            type="DEADLINE_CREATED",
            studentId=request.student_id,
            applicationId=request.application_id,
            userId=context.actor_id,
            metadata='{"source":"python-command"}',
            createdAt=now,
        )
    )
    await append_audit(
        db,
        actor_type=context.actor_type,
        actor_id=context.actor_id,
        user_id=context.actor_id if context.actor_type == "USER" else None,
        action="deadline.create",
        entity_type="Deadline",
        entity_id=deadline_id,
        correlation_id=context.correlation_id,
        after={
            "studentId": request.student_id,
            "applicationId": request.application_id,
            "date": request.date.isoformat(),
            "type": request.type,
        },
        now=now,
    )
    await append_outbox(
        db,
        aggregate_type="Deadline",
        aggregate_id=deadline_id,
        event_type="deadline.created.v1",
        payload={
            "deadline_id": deadline_id,
            "student_id": request.student_id,
            "application_id": request.application_id,
        },
        idempotency_key=f"deadline:create:{context.idempotency_key}",
        now=now,
    )
    await recalculate_student(db, request.student_id, now)
    return CommandResult(
        response={
            "id": deadline_id,
            "title": title,
            "date": request.date,
            "type": request.type,
            "student_id": request.student_id,
            "application_id": request.application_id,
            "is_hard_deadline": request.is_hard_deadline,
            "is_internal": request.is_internal,
            "risk_weight": request.risk_weight,
            "student_name": student_name,
        },
        http_status=status.HTTP_201_CREATED,
        entity_type="Deadline",
        entity_id=deadline_id,
    )
