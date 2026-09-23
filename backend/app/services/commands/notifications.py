from datetime import UTC, datetime

from fastapi import HTTPException, status
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.tables import notification_table
from app.events.records import append_audit, append_outbox
from app.services.commands.base import CommandContext, CommandResult


async def mark_notification_read_command(
    db: AsyncSession,
    *,
    context: CommandContext,
    notification_id: str,
) -> CommandResult:
    notification = (
        await db.execute(
            select(notification_table)
            .where(
                notification_table.c.id == notification_id,
                notification_table.c.userId == context.actor_id,
            )
            .with_for_update()
        )
    ).mappings().first()
    if notification is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Notification not found",
        )
    if notification.readAt is not None:
        return CommandResult(
            response={"id": notification_id, "status": "READ"},
            http_status=status.HTTP_204_NO_CONTENT,
            entity_type="InAppNotification",
            entity_id=notification_id,
        )
    now = datetime.now(UTC)
    await db.execute(
        update(notification_table)
        .where(notification_table.c.id == notification_id)
        .values(readAt=now)
    )
    await append_audit(
        db,
        actor_type=context.actor_type,
        actor_id=context.actor_id,
        user_id=context.actor_id,
        action="notification.read",
        entity_type="InAppNotification",
        entity_id=notification_id,
        correlation_id=context.correlation_id,
        before={"readAt": None},
        after={"readAt": now.isoformat()},
        now=now,
    )
    await append_outbox(
        db,
        aggregate_type="InAppNotification",
        aggregate_id=notification_id,
        event_type="notification.read.v1",
        payload={"notification_id": notification_id},
        idempotency_key=f"notification:read:{context.idempotency_key}",
        now=now,
    )
    return CommandResult(
        response={"id": notification_id, "status": "READ"},
        http_status=status.HTTP_204_NO_CONTENT,
        entity_type="InAppNotification",
        entity_id=notification_id,
    )
