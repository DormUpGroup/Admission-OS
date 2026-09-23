from typing import Annotated

from fastapi import APIRouter, Depends, Query, Response, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import CurrentActor
from app.db.session import get_db_session
from app.db.tables import notification_table
from app.schemas.notifications import NotificationSummary
from app.services.commands.base import (
    CommandContext,
    execute_command,
    require_idempotency_key,
)
from app.services.commands.notifications import mark_notification_read_command

router = APIRouter(tags=["notifications"])
DbSession = Annotated[AsyncSession, Depends(get_db_session)]


@router.get("/notifications", response_model=list[NotificationSummary])
async def list_notifications(
    actor: CurrentActor,
    db: DbSession,
    unread_only: bool = False,
    limit: Annotated[int, Query(ge=1, le=100)] = 50,
) -> list[NotificationSummary]:
    statement = (
        select(notification_table)
        .where(notification_table.c.userId == actor.id)
        .order_by(notification_table.c.createdAt.desc())
        .limit(limit)
    )
    if unread_only:
        statement = statement.where(notification_table.c.readAt.is_(None))
    rows = (await db.execute(statement)).mappings()
    return [
        NotificationSummary(
            id=row.id,
            type=row.type,
            title=row.title,
            body=row.body,
            metadata_json=row.metadataJson,
            read_at=row.readAt,
            created_at=row.createdAt,
        )
        for row in rows
    ]


@router.post("/notifications/{notification_id}/read", status_code=status.HTTP_204_NO_CONTENT)
async def mark_notification_read(
    actor: CurrentActor,
    db: DbSession,
    notification_id: str,
    idempotency_key: Annotated[str, Depends(require_idempotency_key)],
) -> Response:
    async with db.begin():
        context = CommandContext(
            principal_id=actor.id,
            operation="notification.read",
            idempotency_key=idempotency_key,
            correlation_id=idempotency_key,
            actor_type="USER",
            actor_id=actor.id,
        )
        await execute_command(
            db,
            context=context,
            payload={"notification_id": notification_id},
            handler=lambda command: mark_notification_read_command(
                db, context=command, notification_id=notification_id
            ),
        )
    return Response(status_code=status.HTTP_204_NO_CONTENT)
