import asyncio
import os
import socket
from typing import Any
from uuid import uuid4

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.db.session import get_session_factory
from app.events.outbox import (
    OutboxHandler,
    claim_events,
    dispatch_claimed_event,
    mark_failed,
    mark_processed,
    renew_lease,
)
from app.orchestration.hermes_client import HermesClient
from app.orchestration.registry import AGENT_SPECS, agent_for_event
from app.orchestration.runner import (
    finalize_agent_run,
    launch_hermes_run,
    prepare_agent_run,
)
from app.services.delivery.google_calendar import create_google_calendar_event
from app.services.delivery.telegram import deliver_telegram_message

_handlers: dict[str, OutboxHandler] = {}
_orchestration_event_types: set[str] = set()
WORKER_ID = f"{socket.gethostname()}:{os.getpid()}:{uuid4().hex[:8]}"


def register_handler(event_type: str, handler: OutboxHandler) -> None:
    if event_type in _handlers:
        raise RuntimeError(f"Outbox handler already registered: {event_type}")
    _handlers[event_type] = handler


def register_orchestration_event(event_type: str) -> None:
    _orchestration_event_types.add(event_type)


async def _ignore_internal_event(_: AsyncSession, __: dict[str, Any]) -> None:
    """Domain events that currently need only durable audit history."""


async def _cancel_hermes_run(_: AsyncSession, event: dict[str, Any]) -> None:
    hermes_run_id = str(event["payloadJson"].get("hermes_run_id") or "")
    if hermes_run_id:
        await HermesClient().cancel_run(hermes_run_id)


register_handler("task.created.v1", _ignore_internal_event)
register_handler("task.completed.v1", _ignore_internal_event)
register_handler("student.onboarded.v1", _ignore_internal_event)
register_handler("student.accompaniment_accepted.v1", _ignore_internal_event)
register_handler("student.accompaniment_clarification.v1", _ignore_internal_event)
register_handler("student.accompaniment_rejected.v1", _ignore_internal_event)
register_handler("intake_cohort.updated.v1", _ignore_internal_event)
register_handler("message.send.requested.v1", deliver_telegram_message)
register_handler("appointment.created.v1", create_google_calendar_event)
register_handler("agent_run.cancel.requested.v1", _cancel_hermes_run)
register_orchestration_event("message.received.v1")
for _spec in AGENT_SPECS:
    for _event_type in _spec.event_types:
        register_orchestration_event(_event_type)


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
        hermes_run = await launch_hermes_run(launch)
    except Exception as error:
        async with factory() as db:
            async with db.begin():
                failed = await mark_failed(
                    db, event, error, lease_token=lease_token
                )
        return "FAILED" if failed else "LOST_LEASE"

    try:
        async with factory() as db:
            async with db.begin():
                if lease_token:
                    renewed = await renew_lease(db, event["id"], lease_token)
                    if not renewed:
                        return "LOST_LEASE"
                await finalize_agent_run(db, prepared=launch, hermes_run=hermes_run)
                processed = await mark_processed(
                    db, event["id"], lease_token=lease_token
                )
        return "PROCESSED" if processed else "LOST_LEASE"
    except Exception:
        from app.observability.metrics import incr

        incr("hermes_finalize_after_success_failure")
        async with factory() as db:
            async with db.begin():
                failed = await mark_failed(
                    db,
                    event,
                    RuntimeError("finalize_agent_run failed after Hermes success"),
                    lease_token=lease_token,
                )
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
