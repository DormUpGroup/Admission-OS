from collections.abc import Awaitable, Callable
from datetime import UTC, datetime, timedelta
from typing import Any
from uuid import uuid4

from sqlalchemy import or_, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.tables import outbox_event_table

OutboxHandler = Callable[[AsyncSession, dict[str, Any]], Awaitable[None]]


def retry_delay(attempt: int) -> timedelta:
    seconds = min(3600, 2 ** min(attempt, 11))
    jitter = (attempt * 17) % 13
    return timedelta(seconds=seconds + jitter)


async def claim_events(
    db: AsyncSession,
    *,
    worker_id: str,
    limit: int = 25,
    lease_timeout: timedelta = timedelta(minutes=5),
    now: datetime | None = None,
) -> list[dict[str, Any]]:
    now = now or datetime.now(UTC)
    statement = (
        select(outbox_event_table)
        .where(
            or_(
                (
                    (outbox_event_table.c.status == "PENDING")
                    & (outbox_event_table.c.nextAttemptAt <= now)
                ),
                (
                    (outbox_event_table.c.status == "PROCESSING")
                    & (
                        (outbox_event_table.c.leaseExpiresAt.is_not(None))
                        & (outbox_event_table.c.leaseExpiresAt < now)
                    )
                ),
                (
                    (outbox_event_table.c.status == "PROCESSING")
                    & (outbox_event_table.c.leaseExpiresAt.is_(None))
                    & (outbox_event_table.c.lockedAt < now - lease_timeout)
                ),
            )
        )
        .order_by(outbox_event_table.c.createdAt)
        .limit(limit)
        .with_for_update(skip_locked=True)
    )
    rows = [dict(row) for row in (await db.execute(statement)).mappings()]
    if not rows:
        return []
    claimed: list[dict[str, Any]] = []
    expires_at = now + lease_timeout
    for row in rows:
        stale = row["status"] == "PROCESSING"
        lease_token = uuid4().hex
        await db.execute(
            update(outbox_event_table)
            .where(outbox_event_table.c.id == row["id"])
            .values(
                status="PROCESSING",
                lockedBy=worker_id,
                lockedAt=now,
                leaseToken=lease_token,
                leaseExpiresAt=expires_at,
                updatedAt=now,
            )
        )
        if stale:
            from app.observability.metrics import incr

            incr("stale_lease_claims")
        row["status"] = "PROCESSING"
        row["lockedBy"] = worker_id
        row["lockedAt"] = now
        row["leaseToken"] = lease_token
        row["leaseExpiresAt"] = expires_at
        claimed.append(row)
    return claimed


async def renew_lease(
    db: AsyncSession,
    event_id: str,
    lease_token: str,
    *,
    extend_by: timedelta = timedelta(minutes=5),
    now: datetime | None = None,
) -> bool:
    now = now or datetime.now(UTC)
    result = await db.execute(
        update(outbox_event_table)
        .where(
            outbox_event_table.c.id == event_id,
            outbox_event_table.c.status == "PROCESSING",
            outbox_event_table.c.leaseToken == lease_token,
        )
        .values(leaseExpiresAt=now + extend_by, lockedAt=now, updatedAt=now)
    )
    return bool(result.rowcount and result.rowcount > 0)


async def mark_processed(
    db: AsyncSession,
    event_id: str,
    *,
    lease_token: str | None = None,
    now: datetime | None = None,
) -> bool:
    now = now or datetime.now(UTC)
    conditions = [
        outbox_event_table.c.id == event_id,
        outbox_event_table.c.status == "PROCESSING",
    ]
    if lease_token is not None:
        conditions.append(outbox_event_table.c.leaseToken == lease_token)
    result = await db.execute(
        update(outbox_event_table)
        .where(*conditions)
        .values(
            status="PROCESSED",
            processedAt=now,
            lockedBy=None,
            lockedAt=None,
            leaseToken=None,
            leaseExpiresAt=None,
            lastError=None,
            updatedAt=now,
        )
    )
    return bool(result.rowcount and result.rowcount > 0)


async def mark_failed(
    db: AsyncSession,
    event: dict[str, Any],
    error: Exception,
    *,
    lease_token: str | None = None,
    now: datetime | None = None,
) -> str | None:
    now = now or datetime.now(UTC)
    attempts = int(event["attempts"]) + 1
    exhausted = attempts >= int(event["maxAttempts"])
    status = "DEAD" if exhausted else "PENDING"
    token = lease_token if lease_token is not None else event.get("leaseToken")
    conditions = [
        outbox_event_table.c.id == event["id"],
        outbox_event_table.c.status == "PROCESSING",
    ]
    if token is not None:
        conditions.append(outbox_event_table.c.leaseToken == token)
    result = await db.execute(
        update(outbox_event_table)
        .where(*conditions)
        .values(
            status=status,
            attempts=attempts,
            nextAttemptAt=now + retry_delay(attempts),
            lockedBy=None,
            lockedAt=None,
            leaseToken=None,
            leaseExpiresAt=None,
            lastError=f"{type(error).__name__}: {error}"[:2000],
            updatedAt=now,
        )
    )
    if not (result.rowcount and result.rowcount > 0):
        return None
    event["attempts"] = attempts
    return status


async def dispatch_claimed_event(
    db: AsyncSession,
    event: dict[str, Any],
    handlers: dict[str, OutboxHandler],
) -> str:
    lease_token = event.get("leaseToken")
    handler = handlers.get(event["eventType"])
    if handler is None:
        failed = await mark_failed(
            db,
            event,
            RuntimeError(f"No handler for {event['eventType']}"),
            lease_token=lease_token,
        )
        return "FAILED" if failed else "LOST_LEASE"
    try:
        await handler(db, event)
    except Exception as error:
        failed = await mark_failed(db, event, error, lease_token=lease_token)
        return "FAILED" if failed else "LOST_LEASE"
    processed = await mark_processed(db, event["id"], lease_token=lease_token)
    if not processed:
        from app.observability.metrics import incr

        incr("lost_lease_finalizations")
        return "LOST_LEASE"
    return "PROCESSED"
