from datetime import UTC, datetime
from typing import Any
from uuid import uuid4

from sqlalchemy import insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.tables import audit_log_table, outbox_event_table


async def append_audit(
    db: AsyncSession,
    *,
    actor_type: str,
    actor_id: str | None,
    action: str,
    entity_type: str,
    entity_id: str,
    correlation_id: str,
    user_id: str | None = None,
    agent_run_id: str | None = None,
    before: dict[str, Any] | None = None,
    after: dict[str, Any] | None = None,
    metadata: dict[str, Any] | None = None,
    now: datetime | None = None,
) -> str:
    audit_id = uuid4().hex
    await db.execute(
        insert(audit_log_table).values(
            id=audit_id,
            actorType=actor_type,
            actorId=actor_id,
            userId=user_id,
            agentRunId=agent_run_id,
            action=action,
            entityType=entity_type,
            entityId=entity_id,
            correlationId=correlation_id,
            beforeJson=before,
            afterJson=after,
            metadataJson=metadata,
            createdAt=now or datetime.now(UTC),
        )
    )
    return audit_id


async def append_outbox(
    db: AsyncSession,
    *,
    aggregate_type: str,
    aggregate_id: str,
    event_type: str,
    payload: dict[str, Any],
    idempotency_key: str,
    event_version: int = 1,
    now: datetime | None = None,
) -> str:
    event_id = uuid4().hex
    timestamp = now or datetime.now(UTC)
    await db.execute(
        insert(outbox_event_table).values(
            id=event_id,
            aggregateType=aggregate_type,
            aggregateId=aggregate_id,
            eventType=event_type,
            eventVersion=event_version,
            payloadJson=payload,
            status="PENDING",
            attempts=0,
            maxAttempts=8,
            nextAttemptAt=timestamp,
            idempotencyKey=idempotency_key,
            createdAt=timestamp,
            updatedAt=timestamp,
        )
    )
    return event_id
