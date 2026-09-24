import asyncio
import os
import socket
from dataclasses import dataclass
from typing import Any
from uuid import uuid4

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.db.session import get_session_factory
from app.events.outbox import (
    DEFAULT_LEASE_TIMEOUT,
    LostLease,
    OutboxHandler,
    claim_events,
    dispatch_claimed_event,
    mark_failed,
    mark_processed,
    renew_lease,
    run_with_lease_heartbeat,
)
from app.observability.metrics import incr
from app.orchestration.hermes_client import HermesClient
from app.orchestration.registry import AGENT_SPECS, agent_for_event
from app.orchestration.runner import (
    finalize_agent_run,
    launch_hermes_run,
    prepare_agent_run,
)
from app.services.catalog.universitaly_reset import handle_universitaly_cache_reset
from app.services.delivery.google_calendar import (
    CalendarCallResult,
    PreparedCalendarCreate,
    call_google_calendar_event,
    finalize_google_calendar_event,
    prepare_google_calendar_event,
)
from app.services.delivery.telegram import (
    PreparedTelegramDelivery,
    TelegramCallResult,
    call_telegram_delivery,
    finalize_telegram_delivery,
    prepare_telegram_delivery,
)

_handlers: dict[str, OutboxHandler] = {}
_orchestration_event_types: set[str] = set()
# Handlers that perform external I/O: prepare (txn) → heartbeat(call) → finalize (txn).
_external_handlers: set[str] = {
    "message.send.requested.v1",
    "appointment.created.v1",
    "agent_run.cancel.requested.v1",
}
WORKER_ID = f"{socket.gethostname()}:{os.getpid()}:{uuid4().hex[:8]}"


def register_handler(event_type: str, handler: OutboxHandler) -> None:
    if event_type in _handlers:
        raise RuntimeError(f"Outbox handler already registered: {event_type}")
    _handlers[event_type] = handler


def register_orchestration_event(event_type: str) -> None:
    _orchestration_event_types.add(event_type)


async def _ignore_internal_event(_: AsyncSession, __: dict[str, Any]) -> None:
    """Domain events that currently need only durable audit history."""


@dataclass(frozen=True)
class PreparedHermesCancel:
    hermes_run_id: str | None


async def prepare_hermes_cancel(
    _db: AsyncSession, event: dict[str, Any]
) -> PreparedHermesCancel:
    """Validate cancel payload inside a short transaction. No HTTP.

    Hermes cancel is idempotent: reclaim may call cancel again safely.
    """
    hermes_run_id = str(event["payloadJson"].get("hermes_run_id") or "") or None
    return PreparedHermesCancel(hermes_run_id=hermes_run_id)


async def call_hermes_cancel(prepared: PreparedHermesCancel) -> None:
    if prepared.hermes_run_id:
        await HermesClient().cancel_run(prepared.hermes_run_id)


async def finalize_hermes_cancel(
    _db: AsyncSession, _prepared: PreparedHermesCancel
) -> None:
    """No domain row to update; outbox mark_processed is the finalize step."""


# Legacy registrations kept for non-external dispatch_claimed_event paths / tests.
register_handler("task.created.v1", _ignore_internal_event)
register_handler("task.completed.v1", _ignore_internal_event)
register_handler("student.onboarded.v1", _ignore_internal_event)
register_handler("student.accompaniment_accepted.v1", _ignore_internal_event)
register_handler("student.accompaniment_clarification.v1", _ignore_internal_event)
register_handler("student.accompaniment_rejected.v1", _ignore_internal_event)
register_handler("intake_cohort.updated.v1", _ignore_internal_event)


async def _legacy_telegram(db: AsyncSession, event: dict[str, Any]) -> None:
    from app.services.delivery.telegram import deliver_telegram_message

    await deliver_telegram_message(db, event)


async def _legacy_calendar(db: AsyncSession, event: dict[str, Any]) -> None:
    from app.services.delivery.google_calendar import create_google_calendar_event

    await create_google_calendar_event(db, event)


async def _legacy_hermes_cancel(db: AsyncSession, event: dict[str, Any]) -> None:
    prepared = await prepare_hermes_cancel(db, event)
    await call_hermes_cancel(prepared)


register_handler("message.send.requested.v1", _legacy_telegram)
register_handler("appointment.created.v1", _legacy_calendar)
register_handler("agent_run.cancel.requested.v1", _legacy_hermes_cancel)
register_handler(
    "catalog.universitaly_cache.reset.v1",
    handle_universitaly_cache_reset,
)
register_handler("university.created.v1", _ignore_internal_event)
register_handler("program.created.v1", _ignore_internal_event)
register_handler("program_match.reset.v1", _ignore_internal_event)
register_handler("program_match.reviewed.v1", _ignore_internal_event)
register_handler("program_match.manual_upsert.v1", _ignore_internal_event)
register_handler("program_match.replaced.v1", _ignore_internal_event)
register_handler("case.recalculated.v1", _ignore_internal_event)
register_orchestration_event("message.received.v1")
for _spec in AGENT_SPECS:
    for _event_type in _spec.event_types:
        register_orchestration_event(_event_type)


async def _dispatch_external_handler(
    factory: async_sessionmaker[AsyncSession], event: dict[str, Any]
) -> str:
    """Prepare (short txn) → external call under heartbeat → finalize (short txn).

    HTTP never runs inside the prepare or finalize database transaction.
    """
    lease_token = event.get("leaseToken")
    event_type = event["eventType"]

    prepared: (
        PreparedTelegramDelivery | PreparedCalendarCreate | PreparedHermesCancel | None
    ) = None
    skip_call = False

    async with factory() as db:
        async with db.begin():
            if lease_token:
                owned = await renew_lease(db, event["id"], lease_token)
                if not owned:
                    incr("lost_lease_finalizations")
                    return "LOST_LEASE"
            if event_type == "message.send.requested.v1":
                prepared = await prepare_telegram_delivery(db, event)
                skip_call = prepared.action != "send"
            elif event_type == "appointment.created.v1":
                prepared = await prepare_google_calendar_event(db, event)
                skip_call = prepared.action != "create"
            elif event_type == "agent_run.cancel.requested.v1":
                prepared = await prepare_hermes_cancel(db, event)
                skip_call = prepared.hermes_run_id is None
            else:
                failed = await mark_failed(
                    db,
                    event,
                    RuntimeError(f"No external handler for {event_type}"),
                    lease_token=lease_token,
                )
                if failed:
                    incr("ordinary_retry", provider="outbox")
                return "FAILED" if failed else "LOST_LEASE"

            if skip_call:
                if isinstance(prepared, PreparedTelegramDelivery):
                    await finalize_telegram_delivery(db, prepared)
                elif isinstance(prepared, PreparedCalendarCreate):
                    await finalize_google_calendar_event(db, prepared)
                processed = await mark_processed(
                    db, event["id"], lease_token=lease_token
                )
                if not processed:
                    incr("lost_lease_finalizations")
                    return "LOST_LEASE"
                return "PROCESSED"

    assert prepared is not None

    call_result: TelegramCallResult | CalendarCallResult | None = None
    call_error: Exception | None = None

    async def _external_call() -> TelegramCallResult | CalendarCallResult | None:
        if isinstance(prepared, PreparedTelegramDelivery):
            return await call_telegram_delivery(prepared)
        if isinstance(prepared, PreparedCalendarCreate):
            return await call_google_calendar_event(prepared)
        await call_hermes_cancel(prepared)
        return None

    try:
        if lease_token:
            call_result = await run_with_lease_heartbeat(
                factory,
                event_id=event["id"],
                lease_token=lease_token,
                awaitable=_external_call(),
                lease_timeout=DEFAULT_LEASE_TIMEOUT,
            )
        else:
            call_result = await _external_call()
    except LostLease:
        incr("lost_lease_finalizations")
        return "LOST_LEASE"
    except Exception as error:
        call_error = error

    async with factory() as db:
        async with db.begin():
            if lease_token:
                owned = await renew_lease(db, event["id"], lease_token)
                if not owned:
                    incr("lost_lease_finalizations")
                    return "LOST_LEASE"

            if isinstance(prepared, PreparedTelegramDelivery):
                if call_error is not None:
                    outcome = await finalize_telegram_delivery(
                        db, prepared, error=call_error
                    )
                    if outcome == "unknown":
                        processed = await mark_processed(
                            db, event["id"], lease_token=lease_token
                        )
                        if not processed:
                            incr("lost_lease_finalizations")
                            return "LOST_LEASE"
                        return "PROCESSED"
                    failed = await mark_failed(
                        db, event, call_error, lease_token=lease_token
                    )
                    if failed:
                        incr("ordinary_retry", provider="TELEGRAM")
                    return "FAILED" if failed else "LOST_LEASE"
                assert isinstance(call_result, TelegramCallResult)
                await finalize_telegram_delivery(db, prepared, result=call_result)
            elif isinstance(prepared, PreparedCalendarCreate):
                if call_error is not None:
                    failed = await mark_failed(
                        db, event, call_error, lease_token=lease_token
                    )
                    if failed:
                        incr("ordinary_retry", provider="GOOGLE_CALENDAR")
                    return "FAILED" if failed else "LOST_LEASE"
                assert isinstance(call_result, CalendarCallResult)
                await finalize_google_calendar_event(db, prepared, result=call_result)
            else:
                if call_error is not None:
                    failed = await mark_failed(
                        db, event, call_error, lease_token=lease_token
                    )
                    if failed:
                        incr("ordinary_retry", provider="HERMES")
                    return "FAILED" if failed else "LOST_LEASE"
                await finalize_hermes_cancel(db, prepared)

            processed = await mark_processed(
                db, event["id"], lease_token=lease_token
            )
    if not processed:
        incr("lost_lease_finalizations")
        return "LOST_LEASE"
    return "PROCESSED"


async def _dispatch_orchestration_event(
    factory: async_sessionmaker[AsyncSession], event: dict[str, Any]
) -> str:
    lease_token = event.get("leaseToken")
    if agent_for_event(str(event["eventType"])) is None:
        async with factory() as db:
            async with db.begin():
                failed = await mark_failed(
                    db,
                    event,
                    RuntimeError(f"No handler for {event['eventType']}"),
                    lease_token=lease_token,
                )
                if failed:
                    incr("ordinary_retry", provider="hermes_orchestration")
        return "FAILED" if failed else "LOST_LEASE"

    async with factory() as db:
        async with db.begin():
            prepared = await prepare_agent_run(db, event)
            if prepared is None or prepared.already_launched:
                processed = await mark_processed(
                    db, event["id"], lease_token=lease_token
                )
                return "PROCESSED" if processed else "LOST_LEASE"
            launch = prepared
            if lease_token:
                await renew_lease(db, event["id"], lease_token)

    try:
        # Heartbeat must run DURING launch_hermes_run (create_run timeout=180s).
        if lease_token:
            hermes_run = await run_with_lease_heartbeat(
                factory,
                event_id=event["id"],
                lease_token=lease_token,
                awaitable=launch_hermes_run(launch),
                lease_timeout=DEFAULT_LEASE_TIMEOUT,
            )
        else:
            hermes_run = await launch_hermes_run(launch)
    except LostLease:
        # Do not stale-finalize; Hermes idempotency key prevents double-run on reclaim.
        incr("lost_lease_finalizations")
        return "LOST_LEASE"
    except Exception as error:
        async with factory() as db:
            async with db.begin():
                failed = await mark_failed(
                    db, event, error, lease_token=lease_token
                )
                if failed:
                    incr("ordinary_retry", provider="HERMES")
        return "FAILED" if failed else "LOST_LEASE"

    try:
        async with factory() as db:
            async with db.begin():
                if lease_token:
                    renewed = await renew_lease(db, event["id"], lease_token)
                    if not renewed:
                        incr("lost_lease_finalizations")
                        return "LOST_LEASE"
                await finalize_agent_run(db, prepared=launch, hermes_run=hermes_run)
                processed = await mark_processed(
                    db, event["id"], lease_token=lease_token
                )
        return "PROCESSED" if processed else "LOST_LEASE"
    except Exception:
        incr("hermes_finalize_after_success_failure")
        async with factory() as db:
            async with db.begin():
                failed = await mark_failed(
                    db,
                    event,
                    RuntimeError("finalize_agent_run failed after Hermes success"),
                    lease_token=lease_token,
                )
                if failed:
                    incr("ordinary_retry", provider="HERMES")
        return "FAILED" if failed else "LOST_LEASE"


async def dispatch_outbox_batch(limit: int = 25) -> dict[str, int]:
    factory = get_session_factory()
    async with factory() as db:
        async with db.begin():
            events = await claim_events(db, worker_id=WORKER_ID, limit=limit)

    processed = 0
    failed = 0
    lost_lease = 0
    for event in events:
        if event["eventType"] in _orchestration_event_types:
            result = await _dispatch_orchestration_event(factory, event)
        elif event["eventType"] in _external_handlers:
            result = await _dispatch_external_handler(factory, event)
        else:
            async with factory() as db:
                async with db.begin():
                    result = await dispatch_claimed_event(db, event, _handlers)
        if result == "PROCESSED":
            processed += 1
        elif result == "LOST_LEASE":
            lost_lease += 1
        else:
            failed += 1
    return {
        "claimed": len(events),
        "processed": processed,
        "failed": failed,
        "lost_lease": lost_lease,
    }


def dispatch_outbox_batch_sync(limit: int = 25) -> dict[str, int]:
    return asyncio.run(dispatch_outbox_batch(limit))
