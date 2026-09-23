from datetime import UTC, datetime
from typing import Any
from uuid import uuid4

from sqlalchemy import insert, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.tables import appointment_table, conversation_table
from app.events.records import append_audit, append_outbox
from app.services.commands.base import CommandContext, CommandResult


async def create_appointment_command(
    db: AsyncSession,
    *,
    context: CommandContext,
    curator_id: str,
    starts_at: datetime,
    ends_at: datetime,
    timezone: str = "Europe/Rome",
    lead_id: str | None = None,
    student_id: str | None = None,
    conversation_id: str | None = None,
    title: str = "Консультация",
    participants: Any = None,
) -> CommandResult:
    if starts_at.tzinfo is None or ends_at.tzinfo is None or ends_at <= starts_at:
        raise ValueError("A valid timezone-aware appointment interval is required")
    if (lead_id is None) == (student_id is None):
        raise ValueError("Exactly one of lead_id or student_id is required")
    existing = (
        await db.execute(
            select(appointment_table).where(
                appointment_table.c.clientRequestId == context.idempotency_key
            )
        )
    ).mappings().first()
    if existing:
        return CommandResult(
            response={"appointment_id": existing.id, "status": existing.status},
            entity_type="Appointment",
            entity_id=existing.id,
        )
    conflict = (
        await db.execute(
            select(appointment_table.c.id).where(
                appointment_table.c.assignedCuratorId == curator_id,
                appointment_table.c.status.in_(["PENDING", "CONFIRMED"]),
                appointment_table.c.startsAt < ends_at,
                appointment_table.c.endsAt > starts_at,
            )
        )
    ).scalar_one_or_none()
    if conflict:
        raise ValueError("The selected slot is no longer available")
    appointment_id = uuid4().hex
    now = datetime.now(UTC)
    await db.execute(
        insert(appointment_table).values(
            id=appointment_id,
            clientRequestId=context.idempotency_key,
            leadId=lead_id,
            studentId=student_id,
            conversationId=conversation_id,
            assignedCuratorId=curator_id,
            title=title,
            startsAt=starts_at.astimezone(UTC),
            endsAt=ends_at.astimezone(UTC),
            timezone=timezone,
            status="PENDING",
            participantsJson=participants,
            createdAt=now,
            updatedAt=now,
        )
    )
    await append_audit(
        db,
        actor_type=context.actor_type,
        actor_id=context.actor_id,
        user_id=context.actor_id if context.actor_type == "USER" else None,
        action="appointment.create",
        entity_type="Appointment",
        entity_id=appointment_id,
        correlation_id=context.correlation_id,
        after={"status": "PENDING", "curatorId": curator_id},
        now=now,
    )
    await append_outbox(
        db,
        aggregate_type="Appointment",
        aggregate_id=appointment_id,
        event_type="appointment.created.v1",
        payload={"appointment_id": appointment_id},
        idempotency_key=f"appointment:create:{context.idempotency_key}",
        now=now,
    )
    return CommandResult(
        response={"appointment_id": appointment_id, "status": "PENDING"},
        http_status=201,
        entity_type="Appointment",
        entity_id=appointment_id,
    )


async def request_scheduling_command(
    db: AsyncSession,
    *,
    context: CommandContext,
    conversation_id: str,
) -> CommandResult:
    conversation = (
        await db.execute(
            select(conversation_table).where(conversation_table.c.id == conversation_id)
        )
    ).mappings().first()
    if conversation is None:
        raise ValueError("Conversation not found")
    event_id = await append_outbox(
        db,
        aggregate_type="Conversation",
        aggregate_id=conversation_id,
        event_type="scheduling.requested.v1",
        payload={
            "conversation_id": conversation_id,
            "lead_id": conversation.leadId,
            "student_id": conversation.studentId,
        },
        idempotency_key=f"scheduling:request:{context.idempotency_key}",
    )
    await append_audit(
        db,
        actor_type=context.actor_type,
        actor_id=context.actor_id,
        user_id=context.actor_id if context.actor_type == "USER" else None,
        action="scheduling.request",
        entity_type="Conversation",
        entity_id=conversation_id,
        correlation_id=context.correlation_id,
        after={"eventId": event_id, "status": "QUEUED"},
    )
    return CommandResult(
        response={"event_id": event_id, "status": "QUEUED"},
        entity_type="Conversation",
        entity_id=conversation_id,
    )
