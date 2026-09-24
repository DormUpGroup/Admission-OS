from collections.abc import Awaitable, Callable
from datetime import UTC, datetime, timedelta
from typing import Any
from uuid import uuid4

from sqlalchemy import or_, select, update
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.db.tables import outbox_event_table

OutboxHandler = Callable[[AsyncSession, dict[str, Any]], Awaitable[None]]

# Default lease must exceed Hermes create_run HTTP timeout (180s) with margin.
# Heartbeats renew during long external calls (~1/3 of this interval).
DEFAULT_LEASE_TIMEOUT = timedelta(minutes=5)


class LostLease(Exception):
    """Raised when this worker no longer holds the outbox fencing token."""


def retry_delay(attempt: int) -> timedelta:
    seconds = min(3600, 2 ** min(attempt, 11))
    jitter = (attempt * 17) % 13
    return timedelta(seconds=seconds + jitter)


async def claim_events(
    db: AsyncSession,
    *,
    worker_id: str,
    limit: int = 25,
    lease_timeout: timedelta = DEFAULT_LEASE_TIMEOUT,
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
    extend_by: timedelta = DEFAULT_LEASE_TIMEOUT,
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


async def run_with_lease_heartbeat[T](
    factory: async_sessionmaker[AsyncSession],
    *,
    event_id: str,
    lease_token: str,
    awaitable: Awaitable[T],
    lease_timeout: timedelta = DEFAULT_LEASE_TIMEOUT,
) -> T:
    """Run an external call while renewing the lease in a separate session.

    Heartbeat interval is ~1/3 of ``lease_timeout``. Lease is checked before and
    after the call. If a heartbeat loses the fencing token, raises ``LostLease``
    and must not be treated as success (do not stale-finalize).
    """
    import asyncio

    from app.observability.metrics import incr

    async def _renew() -> bool:
        async with factory() as db:
            async with db.begin():
                return await renew_lease(
                    db, event_id, lease_token, extend_by=lease_timeout
                )

    if not await _renew():
        incr("lost_lease_heartbeats")
        close = getattr(awaitable, "close", None)
        if callable(close):
            close()
        raise LostLease(event_id)

    stop = asyncio.Event()
    lost = asyncio.Event()
    interval = max(1.0, lease_timeout.total_seconds() / 3)

    async def _heartbeat() -> None:
        while not stop.is_set():
            try:
                await asyncio.wait_for(stop.wait(), timeout=interval)
                return
            except TimeoutError:
                pass
            if not await _renew():
                incr("lost_lease_heartbeats")
                lost.set()
                return

    heartbeat_task = asyncio.create_task(_heartbeat())
    try:
        result = await awaitable
        if lost.is_set():
            raise LostLease(event_id)
        if not await _renew():
            incr("lost_lease_heartbeats")
            raise LostLease(event_id)
        return result
    finally:
        stop.set()
        heartbeat_task.cancel()
        try:
            await heartbeat_task
        except asyncio.CancelledError:
            pass


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
