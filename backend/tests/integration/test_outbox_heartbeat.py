"""Postgres integration tests for outbox lease heartbeat and fencing."""

from __future__ import annotations

import asyncio
import os
from datetime import UTC, datetime, timedelta
from types import SimpleNamespace
from uuid import uuid4

import httpx
import pytest
from sqlalchemy import event, insert, select, text, update
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from sqlalchemy.pool import NullPool

from app.db.session import _async_database_url
from app.db.tables import metadata, outbox_event_table
from app.events.outbox import (
    LostLease,
    claim_events,
    mark_failed,
    mark_processed,
    renew_lease,
    run_with_lease_heartbeat,
)
from app.observability.metrics import get_counts, reset_counts
from app.orchestration.hermes_client import HermesRun
from app.workers import outbox as outbox_module

pytestmark = pytest.mark.postgres


def _database_url() -> str | None:
    url = os.environ.get("DATABASE_URL") or os.environ.get(
        "SCHEMA_CONTRACT_DATABASE_URL"
    )
    if not url or "sqlite" in url:
        return None
    if not url.startswith(("postgresql", "postgres")):
        return None
    return url


@pytest.fixture
async def pg_factory():
    url = _database_url()
    if url is None:
        pytest.skip("PostgreSQL DATABASE_URL is not configured")
    schema = f"itest_{uuid4().hex[:12]}"
    engine = create_async_engine(
        _async_database_url(url),
        poolclass=NullPool,
    )

    def _set_search_path(dbapi_connection, connection_record) -> None:
        cursor = dbapi_connection.cursor()
        cursor.execute(f'SET search_path TO "{schema}"')
        cursor.close()

    event.listen(engine.sync_engine, "connect", _set_search_path)

    async with engine.begin() as connection:
        await connection.execute(text(f'CREATE SCHEMA "{schema}"'))
        await connection.run_sync(metadata.create_all)

    factory = async_sessionmaker(engine, expire_on_commit=False)
    yield factory

    async with engine.begin() as connection:
        await connection.execute(text(f'DROP SCHEMA IF EXISTS "{schema}" CASCADE'))
    await engine.dispose()


async def _insert_event(factory, *, event_id: str, event_type: str = "task.created.v1"):
    now = datetime.now(UTC)
    async with factory() as db:
        async with db.begin():
            await db.execute(
                insert(outbox_event_table).values(
                    id=event_id,
                    aggregateType="Task",
                    aggregateId=f"task-{event_id}",
                    eventType=event_type,
                    eventVersion=1,
                    payloadJson={},
                    status="PENDING",
                    attempts=0,
                    maxAttempts=8,
                    nextAttemptAt=now,
                    idempotencyKey=f"key-{event_id}-{uuid4().hex}",
                    createdAt=now,
                    updatedAt=now,
                )
            )
    return now


async def test_heartbeat_keeps_lease_during_slow_handler(pg_factory) -> None:
    factory = pg_factory
    reset_counts()
    event_id = f"hb-{uuid4().hex[:8]}"
    now = await _insert_event(factory, event_id=event_id)
    lease = timedelta(seconds=3)

    async with factory() as db:
        async with db.begin():
            claimed = await claim_events(
                db, worker_id="worker-hb", now=now, lease_timeout=lease
            )
    assert len(claimed) == 1
    token = claimed[0]["leaseToken"]

    async def slow() -> str:
        await asyncio.sleep(5)
        return "done"

    result = await run_with_lease_heartbeat(
        factory,
        event_id=event_id,
        lease_token=token,
        awaitable=slow(),
        lease_timeout=lease,
    )
    assert result == "done"

    async with factory() as db:
        async with db.begin():
            stolen = await claim_events(
                db,
                worker_id="worker-thief",
                now=datetime.now(UTC),
                lease_timeout=lease,
            )
    assert stolen == []

    async with factory() as db:
        async with db.begin():
            assert await mark_processed(db, event_id, lease_token=token)


async def test_stale_worker_cannot_finalize_after_takeover(pg_factory) -> None:
    factory = pg_factory
    event_id = f"stale-{uuid4().hex[:8]}"
    now = await _insert_event(factory, event_id=event_id)
    lease = timedelta(seconds=2)

    async with factory() as db:
        async with db.begin():
            first = await claim_events(
                db, worker_id="old", now=now, lease_timeout=lease
            )
    stale = first[0]["leaseToken"]

    async with factory() as db:
        async with db.begin():
            second = await claim_events(
                db,
                worker_id="new",
                now=first[0]["leaseExpiresAt"] + timedelta(seconds=1),
                lease_timeout=lease,
            )
    assert second[0]["leaseToken"] != stale

    async with factory() as db:
        async with db.begin():
            assert not await mark_processed(db, event_id, lease_token=stale)
            assert not await mark_failed(
                db, first[0], RuntimeError("stale"), lease_token=stale
            )
            assert await mark_processed(
                db, event_id, lease_token=second[0]["leaseToken"]
            )


async def test_lost_lease_does_not_change_new_owner_status(pg_factory) -> None:
    factory = pg_factory
    reset_counts()
    event_id = f"lost-{uuid4().hex[:8]}"
    now = await _insert_event(factory, event_id=event_id)
    lease = timedelta(seconds=2)

    async with factory() as db:
        async with db.begin():
            first = await claim_events(
                db, worker_id="old", now=now, lease_timeout=lease
            )
    stale = first[0]["leaseToken"]

    async with factory() as db:
        async with db.begin():
            second = await claim_events(
                db,
                worker_id="new",
                now=first[0]["leaseExpiresAt"] + timedelta(seconds=1),
                lease_timeout=lease,
            )
    new_token = second[0]["leaseToken"]

    async def noop() -> None:
        return None

    with pytest.raises(LostLease):
        await run_with_lease_heartbeat(
            factory,
            event_id=event_id,
            lease_token=stale,
            awaitable=noop(),
            lease_timeout=lease,
        )

    assert get_counts().get("lost_lease_heartbeats", 0) >= 1

    async with factory() as db:
        row = (
            await db.execute(
                select(outbox_event_table).where(outbox_event_table.c.id == event_id)
            )
        ).mappings().one()
    assert row.status == "PROCESSING"
    assert row.leaseToken == new_token

    async with factory() as db:
        async with db.begin():
            assert await mark_processed(db, event_id, lease_token=new_token)

    async with factory() as db:
        status = (
            await db.execute(
                select(outbox_event_table.c.status).where(
                    outbox_event_table.c.id == event_id
                )
            )
        ).scalar_one()
    assert status == "PROCESSED"


async def test_hermes_lost_lease_does_not_double_run(pg_factory, monkeypatch) -> None:
    factory = pg_factory
    reset_counts()
    event_id = f"hermes-{uuid4().hex[:8]}"
    now = datetime.now(UTC)
    async with factory() as db:
        async with db.begin():
            await db.execute(
                insert(outbox_event_table).values(
                    id=event_id,
                    aggregateType="Conversation",
                    aggregateId="conversation_1",
                    eventType="message.received.v1",
                    eventVersion=1,
                    payloadJson={"conversation_id": "conversation_1"},
                    status="PENDING",
                    attempts=0,
                    maxAttempts=8,
                    nextAttemptAt=now,
                    idempotencyKey=f"hermes-idemp-{uuid4().hex}",
                    createdAt=now,
                    updatedAt=now,
                )
            )

    launches: list[str] = []
    started = asyncio.Event()
    release = asyncio.Event()

    async def fake_prepare(db, event):
        return SimpleNamespace(
            run_id="run_1",
            agent_key="intake",
            conversation_id="conversation_1",
            hermes_session_id=None,
            prompt="prompt",
            hermes_idempotency_key=event["idempotencyKey"],
            already_launched=False,
            skipped=False,
        )

    async def fake_launch(prepared):
        launches.append(prepared.hermes_idempotency_key)
        started.set()
        await release.wait()
        return HermesRun(id="h1", status="queued", session_id=None)

    monkeypatch.setattr(outbox_module, "prepare_agent_run", fake_prepare)
    monkeypatch.setattr(outbox_module, "launch_hermes_run", fake_launch)

    async def noop_finalize(*_args, **_kwargs):
        return None

    monkeypatch.setattr(outbox_module, "finalize_agent_run", noop_finalize)
    monkeypatch.setattr(outbox_module, "agent_for_event", lambda _t: object())

    async with factory() as db:
        async with db.begin():
            claimed = await claim_events(
                db,
                worker_id="w1",
                now=now,
                lease_timeout=timedelta(seconds=5),
            )
    event = claimed[0]
    stale_token = event["leaseToken"]

    launch = await fake_prepare(None, event)
    heartbeat_task = asyncio.create_task(
        run_with_lease_heartbeat(
            factory,
            event_id=event_id,
            lease_token=stale_token,
            awaitable=fake_launch(launch),
            lease_timeout=timedelta(seconds=3),
        )
    )
    await started.wait()
    async with factory() as db:
        async with db.begin():
            await db.execute(
                update(outbox_event_table)
                .where(outbox_event_table.c.id == event_id)
                .values(
                    leaseToken="taken-over",
                    lockedBy="w2",
                    leaseExpiresAt=datetime.now(UTC) + timedelta(minutes=5),
                )
            )
    # Allow heartbeat interval to fire, then finish launch.
    await asyncio.sleep(1.2)
    release.set()
    with pytest.raises(LostLease):
        await heartbeat_task
    assert len(launches) == 1
    assert get_counts().get("lost_lease_heartbeats", 0) >= 1

    async def prepare_already(db, event):
        return SimpleNamespace(
            run_id="run_1",
            agent_key="intake",
            conversation_id="conversation_1",
            hermes_session_id=None,
            prompt=None,
            hermes_idempotency_key=event["idempotencyKey"],
            already_launched=True,
            skipped=False,
        )

    monkeypatch.setattr(outbox_module, "prepare_agent_run", prepare_already)
    event["leaseToken"] = "taken-over"
    second = await outbox_module._dispatch_orchestration_event(factory, event)
    assert second == "PROCESSED"
    assert len(launches) == 1


async def test_renew_lease_false_on_token_mismatch(pg_factory) -> None:
    factory = pg_factory
    event_id = f"renew-{uuid4().hex[:8]}"
    now = await _insert_event(factory, event_id=event_id)
    async with factory() as db:
        async with db.begin():
            claimed = await claim_events(db, worker_id="w", now=now)
    token = claimed[0]["leaseToken"]
    async with factory() as db:
        async with db.begin():
            assert await renew_lease(db, event_id, token)
            assert not await renew_lease(db, event_id, "wrong-token")


async def _seed_telegram_outbox(factory, *, suffix: str) -> dict:
    from app.db.tables import (
        channel_identity_table,
        conversation_message_table,
        conversation_table,
        lead_table,
    )

    now = datetime.now(UTC)
    message_id = f"msg-{suffix}"
    event_id = f"evt-tg-{suffix}"
    async with factory() as db:
        async with db.begin():
            await db.execute(
                insert(lead_table).values(
                    id=f"lead-{suffix}",
                    status="QUALIFYING",
                    source="TELEGRAM",
                    consentStatus="GRANTED",
                    createdAt=now,
                    updatedAt=now,
                )
            )
            await db.execute(
                insert(conversation_table).values(
                    id=f"conv-{suffix}",
                    channel="TELEGRAM",
                    status="OPEN",
                    leadId=f"lead-{suffix}",
                    version=1,
                    createdAt=now,
                    updatedAt=now,
                )
            )
            await db.execute(
                insert(conversation_message_table).values(
                    id=message_id,
                    conversationId=f"conv-{suffix}",
                    direction="OUTBOUND",
                    senderType="STAFF",
                    body="hello",
                    deliveryStatus="QUEUED",
                    policyStatus="ALLOWED",
                    createdAt=now,
                    updatedAt=now,
                )
            )
            await db.execute(
                insert(channel_identity_table).values(
                    id=f"ident-{suffix}",
                    channel="TELEGRAM",
                    externalId=f"chat-{suffix}",
                    leadId=f"lead-{suffix}",
                    metadataJson={"chat_id": f"chat-{suffix}"},
                    createdAt=now,
                    updatedAt=now,
                )
            )
            await db.execute(
                insert(outbox_event_table).values(
                    id=event_id,
                    aggregateType="ConversationMessage",
                    aggregateId=message_id,
                    eventType="message.send.requested.v1",
                    eventVersion=1,
                    payloadJson={"message_id": message_id},
                    status="PENDING",
                    attempts=0,
                    maxAttempts=8,
                    nextAttemptAt=now,
                    idempotencyKey=f"tg-key-{suffix}-{uuid4().hex}",
                    createdAt=now,
                    updatedAt=now,
                )
            )
    return {"message_id": message_id, "event_id": event_id, "now": now}


async def test_telegram_prepare_commit_finalize_abort_does_not_resend(
    pg_factory, monkeypatch
) -> None:
    """Prepare committed + provider succeeds + finalize abort → reclaim must not send."""
    from app.db.tables import delivery_attempt_table
    from app.services.delivery import telegram

    factory = pg_factory
    reset_counts()
    ids = await _seed_telegram_outbox(factory, suffix=uuid4().hex[:8])
    sends: list[str] = []

    async def fake_send(self, chat_id, text, *, idempotency_key):
        sends.append(chat_id)
        return "provider-msg-1"

    monkeypatch.setattr(telegram.TelegramAdapter, "send_text", fake_send)

    async with factory() as db:
        async with db.begin():
            claimed = await claim_events(
                db, worker_id="w1", now=ids["now"], lease_timeout=timedelta(minutes=5)
            )
    event = claimed[0]
    assert event["id"] == ids["event_id"]

    async with factory() as db:
        async with db.begin():
            prepared = await telegram.prepare_telegram_delivery(db, event)
    assert prepared.action == "send"

    # Provider succeeds outside DB txn; finalize never runs (crash).
    result = await telegram.call_telegram_delivery(prepared)
    assert result.provider_message_id == "provider-msg-1"
    assert len(sends) == 1

    async with factory() as db:
        attempt = (
            await db.execute(select(delivery_attempt_table))
        ).mappings().one()
    assert attempt.status == "PROCESSING"

    # Expire lease so another worker can reclaim.
    async with factory() as db:
        async with db.begin():
            await db.execute(
                update(outbox_event_table)
                .where(outbox_event_table.c.id == ids["event_id"])
                .values(
                    leaseExpiresAt=datetime.now(UTC) - timedelta(seconds=1),
                    status="PROCESSING",
                )
            )
    async with factory() as db:
        async with db.begin():
            reclaimed = await claim_events(
                db,
                worker_id="w2",
                now=datetime.now(UTC),
                lease_timeout=timedelta(minutes=5),
            )
    assert len(reclaimed) == 1
    second = await outbox_module._dispatch_external_handler(factory, reclaimed[0])
    assert second == "PROCESSED"
    assert len(sends) == 1  # no second send

    async with factory() as db:
        attempt = (
            await db.execute(select(delivery_attempt_table))
        ).mappings().one()
    assert attempt.status == "UNKNOWN_REQUIRES_REVIEW"
    assert get_counts().get("unknown_delivery|provider=TELEGRAM", 0) >= 1


async def test_external_dispatch_lost_lease_cannot_finalize(
    pg_factory, monkeypatch
) -> None:
    from app.services.delivery import telegram

    factory = pg_factory
    reset_counts()
    ids = await _seed_telegram_outbox(factory, suffix=uuid4().hex[:8])
    gate = asyncio.Event()
    release = asyncio.Event()

    async def slow_send(self, chat_id, text, *, idempotency_key):
        gate.set()
        await release.wait()
        return "late-msg"

    monkeypatch.setattr(telegram.TelegramAdapter, "send_text", slow_send)

    async with factory() as db:
        async with db.begin():
            claimed = await claim_events(
                db, worker_id="old", now=ids["now"], lease_timeout=timedelta(seconds=30)
            )
    event = claimed[0]
    stale = event["leaseToken"]

    task = asyncio.create_task(
        outbox_module._dispatch_external_handler(factory, event)
    )
    await gate.wait()
    async with factory() as db:
        async with db.begin():
            await db.execute(
                update(outbox_event_table)
                .where(outbox_event_table.c.id == ids["event_id"])
                .values(
                    leaseToken="taken-over",
                    lockedBy="new",
                    leaseExpiresAt=datetime.now(UTC) + timedelta(minutes=5),
                )
            )
    release.set()
    result = await task
    assert result == "LOST_LEASE"
    assert (
        get_counts().get("lost_lease_finalizations", 0)
        + get_counts().get("lost_lease_heartbeats", 0)
        >= 1
    )
    async with factory() as db:
        async with db.begin():
            assert not await mark_processed(
                db, ids["event_id"], lease_token=stale
            )


async def test_external_heartbeat_keeps_lease_during_slow_telegram(
    pg_factory, monkeypatch
) -> None:
    from app.services.delivery import telegram

    factory = pg_factory
    reset_counts()
    ids = await _seed_telegram_outbox(factory, suffix=uuid4().hex[:8])
    lease = timedelta(seconds=3)

    async def slow_send(self, chat_id, text, *, idempotency_key):
        await asyncio.sleep(5)
        return "slow-ok"

    monkeypatch.setattr(telegram.TelegramAdapter, "send_text", slow_send)

    async with factory() as db:
        async with db.begin():
            claimed = await claim_events(
                db, worker_id="hb-tg", now=ids["now"], lease_timeout=lease
            )
    event = claimed[0]
    monkeypatch.setattr(outbox_module, "DEFAULT_LEASE_TIMEOUT", lease)

    result = await outbox_module._dispatch_external_handler(factory, event)
    assert result == "PROCESSED"

    async with factory() as db:
        async with db.begin():
            stolen = await claim_events(
                db,
                worker_id="thief",
                now=datetime.now(UTC),
                lease_timeout=lease,
            )
    assert stolen == []


async def test_calendar_deterministic_id_on_409(
    pg_factory, monkeypatch
) -> None:
    from app.db.tables import appointment_table, lead_table
    from app.services.delivery import google_calendar
    from app.services.delivery.google_calendar import deterministic_google_event_id

    factory = pg_factory
    now = datetime.now(UTC)
    appointment_id = f"appt-{uuid4().hex[:8]}"
    provider_id = deterministic_google_event_id(appointment_id)
    event_id = f"evt-cal-{uuid4().hex[:8]}"

    monkeypatch.setattr(
        google_calendar,
        "get_settings",
        lambda: SimpleNamespace(
            google_calendar_id="primary",
            google_service_account_json='{"client_email":"svc@example.test","private_key":"x"}',
        ),
    )

    async def fake_token(_credentials):
        return "token"

    def handler(request: httpx.Request) -> httpx.Response:
        if request.method == "POST":
            return httpx.Response(409, json={"error": {"code": 409}})
        if request.method == "GET" and provider_id in str(request.url):
            return httpx.Response(200, json={"id": provider_id})
        return httpx.Response(404, json={})

    original = google_calendar.httpx.AsyncClient
    monkeypatch.setattr(google_calendar, "_access_token", fake_token)
    monkeypatch.setattr(
        google_calendar.httpx,
        "AsyncClient",
        lambda **_kwargs: original(transport=httpx.MockTransport(handler)),
    )

    async with factory() as db:
        async with db.begin():
            await db.execute(
                insert(lead_table).values(
                    id=f"lead-cal-{appointment_id}",
                    status="QUALIFIED",
                    source="TELEGRAM",
                    consentStatus="GRANTED",
                    createdAt=now,
                    updatedAt=now,
                )
            )
            await db.execute(
                insert(appointment_table).values(
                    id=appointment_id,
                    clientRequestId=f"req-{appointment_id}",
                    leadId=f"lead-cal-{appointment_id}",
                    title="Call",
                    startsAt=now + timedelta(days=1),
                    endsAt=now + timedelta(days=1, minutes=30),
                    timezone="Europe/Rome",
                    status="PENDING",
                    createdAt=now,
                    updatedAt=now,
                )
            )
            await db.execute(
                insert(outbox_event_table).values(
                    id=event_id,
                    aggregateType="Appointment",
                    aggregateId=appointment_id,
                    eventType="appointment.created.v1",
                    eventVersion=1,
                    payloadJson={"appointment_id": appointment_id},
                    status="PENDING",
                    attempts=0,
                    maxAttempts=8,
                    nextAttemptAt=now,
                    idempotencyKey=f"cal-{uuid4().hex}",
                    createdAt=now,
                    updatedAt=now,
                )
            )

    async with factory() as db:
        async with db.begin():
            claimed = await claim_events(db, worker_id="cal", now=now)
    result = await outbox_module._dispatch_external_handler(factory, claimed[0])
    assert result == "PROCESSED"
    async with factory() as db:
        row = (
            await db.execute(
                select(appointment_table).where(
                    appointment_table.c.id == appointment_id
                )
            )
        ).mappings().one()
    assert row.googleEventId == provider_id
