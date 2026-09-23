from datetime import UTC, datetime, timedelta
from types import SimpleNamespace

import httpx
from sqlalchemy import insert, select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.db.tables import (
    appointment_table,
    channel_identity_table,
    conversation_message_table,
    conversation_table,
    delivery_attempt_table,
    lead_table,
    metadata,
    outbox_event_table,
)
from app.events.outbox import dispatch_claimed_event
from app.services.delivery import google_calendar, telegram


async def _database():
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    async with engine.begin() as connection:
        await connection.run_sync(metadata.create_all)
    return engine, async_sessionmaker(engine, expire_on_commit=False)


async def test_telegram_timeout_requires_review_and_does_not_retry(
    monkeypatch,
) -> None:
    engine, factory = await _database()
    now = datetime.now(UTC)

    async def timeout(*_args, **_kwargs):
        raise httpx.TimeoutException("telegram send timed out")

    monkeypatch.setattr(telegram.TelegramAdapter, "send_text", timeout)
    async with factory() as db:
        async with db.begin():
            await db.execute(
                insert(lead_table).values(
                    id="lead_1",
                    status="QUALIFYING",
                    source="TELEGRAM",
                    consentStatus="GRANTED",
                    createdAt=now,
                    updatedAt=now,
                )
            )
            await db.execute(
                insert(conversation_table).values(
                    id="conversation_1",
                    channel="TELEGRAM",
                    status="OPEN",
                    leadId="lead_1",
                    version=1,
                    createdAt=now,
                    updatedAt=now,
                )
            )
            await db.execute(
                insert(conversation_message_table).values(
                    id="message_1",
                    conversationId="conversation_1",
                    direction="OUTBOUND",
                    senderType="STAFF",
                    body="Please send your passport",
                    deliveryStatus="QUEUED",
                    policyStatus="ALLOWED",
                    createdAt=now,
                    updatedAt=now,
                )
            )
            await db.execute(
                insert(channel_identity_table).values(
                    id="identity_1",
                    channel="TELEGRAM",
                    externalId="9001",
                    leadId="lead_1",
                    metadataJson={"chat_id": "9001"},
                    createdAt=now,
                    updatedAt=now,
                )
            )
            await telegram.deliver_telegram_message(
                db,
                {
                    "id": "outbox_1",
                    "idempotencyKey": "message:send:key-1",
                    "payloadJson": {"message_id": "message_1"},
                },
            )
        message = (
            await db.execute(
                select(conversation_message_table).where(
                    conversation_message_table.c.id == "message_1"
                )
            )
        ).mappings().one()
        attempt = (
            await db.execute(select(delivery_attempt_table))
        ).mappings().one()
    assert message.deliveryStatus == "UNKNOWN_REQUIRES_REVIEW"
    assert attempt.status == "UNKNOWN_REQUIRES_REVIEW"
    await engine.dispose()


async def test_telegram_timeout_marks_outbox_processed_without_retry(
    monkeypatch,
) -> None:
    engine, factory = await _database()
    now = datetime.now(UTC)

    async def timeout(*_args, **_kwargs):
        raise httpx.TimeoutException("telegram send timed out")

    monkeypatch.setattr(telegram.TelegramAdapter, "send_text", timeout)
    event = {
        "id": "outbox_timeout",
        "eventType": "message.send.requested.v1",
        "attempts": 0,
        "maxAttempts": 8,
        "idempotencyKey": "message:send:key-timeout",
        "payloadJson": {"message_id": "message_timeout"},
    }
    async with factory() as db:
        async with db.begin():
            await db.execute(
                insert(lead_table).values(
                    id="lead_timeout",
                    status="QUALIFYING",
                    source="TELEGRAM",
                    consentStatus="GRANTED",
                    createdAt=now,
                    updatedAt=now,
                )
            )
            await db.execute(
                insert(conversation_table).values(
                    id="conversation_timeout",
                    channel="TELEGRAM",
                    status="OPEN",
                    leadId="lead_timeout",
                    version=1,
                    createdAt=now,
                    updatedAt=now,
                )
            )
            await db.execute(
                insert(conversation_message_table).values(
                    id="message_timeout",
                    conversationId="conversation_timeout",
                    direction="OUTBOUND",
                    senderType="STAFF",
                    body="Please send your passport",
                    deliveryStatus="QUEUED",
                    policyStatus="ALLOWED",
                    createdAt=now,
                    updatedAt=now,
                )
            )
            await db.execute(
                insert(channel_identity_table).values(
                    id="identity_timeout",
                    channel="TELEGRAM",
                    externalId="9003",
                    leadId="lead_timeout",
                    metadataJson={"chat_id": "9003"},
                    createdAt=now,
                    updatedAt=now,
                )
            )
            await db.execute(
                insert(outbox_event_table).values(
                    id="outbox_timeout",
                    aggregateType="ConversationMessage",
                    aggregateId="message_timeout",
                    eventType="message.send.requested.v1",
                    eventVersion=1,
                    payloadJson={"message_id": "message_timeout"},
                    status="PROCESSING",
                    attempts=0,
                    maxAttempts=8,
                    nextAttemptAt=now,
                    idempotencyKey="message:send:key-timeout",
                    createdAt=now,
                    updatedAt=now,
                )
            )
            result = await dispatch_claimed_event(
                db, event, {"message.send.requested.v1": telegram.deliver_telegram_message}
            )
        outbox = (
            await db.execute(
                select(outbox_event_table).where(
                    outbox_event_table.c.id == "outbox_timeout"
                )
            )
        ).mappings().one()
    assert result == "PROCESSED"
    assert outbox.status == "PROCESSED"
    await engine.dispose()


async def test_google_calendar_reuses_event_found_by_appointment_id(
    monkeypatch,
) -> None:
    engine, factory = await _database()
    now = datetime.now(UTC)
    starts = now + timedelta(days=1)
    monkeypatch.setattr(
        google_calendar,
        "get_settings",
        lambda: SimpleNamespace(
            google_calendar_id="primary",
            google_service_account_json='{"client_email":"svc@example.test","private_key":"x"}',
        ),
    )

    async def fake_token(_credentials):
        return "access-token"

    calls: list[str] = []

    def handler(request: httpx.Request) -> httpx.Response:
        calls.append(request.method)
        if request.method == "GET":
            assert "immigromeAppointmentId%3Dappointment_1" in str(request.url)
            return httpx.Response(
                200, json={"items": [{"id": "existing-google-event"}]}
            )
        return httpx.Response(500, json={"error": "should not create"})

    original_client = google_calendar.httpx.AsyncClient
    monkeypatch.setattr(google_calendar, "_access_token", fake_token)
    monkeypatch.setattr(
        google_calendar.httpx,
        "AsyncClient",
        lambda **_kwargs: original_client(transport=httpx.MockTransport(handler)),
    )
    async with factory() as db:
        async with db.begin():
            await db.execute(
                insert(lead_table).values(
                    id="lead_1",
                    status="QUALIFIED",
                    source="TELEGRAM",
                    consentStatus="GRANTED",
                    createdAt=now,
                    updatedAt=now,
                )
            )
            await db.execute(
                insert(appointment_table).values(
                    id="appointment_1",
                    clientRequestId="appointment-request-1",
                    leadId="lead_1",
                    title="Intro call",
                    startsAt=starts,
                    endsAt=starts + timedelta(minutes=30),
                    timezone="Europe/Rome",
                    status="PENDING",
                    createdAt=now,
                    updatedAt=now,
                )
            )
            await google_calendar.create_google_calendar_event(
                db, {"payloadJson": {"appointment_id": "appointment_1"}}
            )
        appointment = (
            await db.execute(
                select(appointment_table).where(
                    appointment_table.c.id == "appointment_1"
                )
            )
        ).mappings().one()
    assert appointment.googleEventId == "existing-google-event"
    assert calls == ["GET"]
    await engine.dispose()


async def test_google_calendar_timeout_after_create_recovers_via_search(
    monkeypatch,
) -> None:
    engine, factory = await _database()
    now = datetime.now(UTC)
    starts = now + timedelta(days=1)
    monkeypatch.setattr(
        google_calendar,
        "get_settings",
        lambda: SimpleNamespace(
            google_calendar_id="primary",
            google_service_account_json='{"client_email":"svc@example.test","private_key":"x"}',
        ),
    )

    async def fake_token(_credentials):
        return "access-token"

    get_calls = {"n": 0}

    def handler(request: httpx.Request) -> httpx.Response:
        if request.method == "GET":
            get_calls["n"] += 1
            if get_calls["n"] == 1:
                return httpx.Response(200, json={"items": []})
            return httpx.Response(
                200, json={"items": [{"id": "recovered-google-event"}]}
            )
        raise httpx.TimeoutException("create timed out")

    original_client = google_calendar.httpx.AsyncClient
    monkeypatch.setattr(google_calendar, "_access_token", fake_token)
    monkeypatch.setattr(
        google_calendar.httpx,
        "AsyncClient",
        lambda **_kwargs: original_client(transport=httpx.MockTransport(handler)),
    )
    async with factory() as db:
        async with db.begin():
            await db.execute(
                insert(lead_table).values(
                    id="lead_2",
                    status="QUALIFIED",
                    source="TELEGRAM",
                    consentStatus="GRANTED",
                    createdAt=now,
                    updatedAt=now,
                )
            )
            await db.execute(
                insert(appointment_table).values(
                    id="appointment_2",
                    clientRequestId="appointment-request-2",
                    leadId="lead_2",
                    title="Follow up",
                    startsAt=starts,
                    endsAt=starts + timedelta(minutes=30),
                    timezone="Europe/Rome",
                    status="PENDING",
                    createdAt=now,
                    updatedAt=now,
                )
            )
            await google_calendar.create_google_calendar_event(
                db, {"payloadJson": {"appointment_id": "appointment_2"}}
            )
        appointment = (
            await db.execute(
                select(appointment_table).where(
                    appointment_table.c.id == "appointment_2"
                )
            )
        ).mappings().one()
    assert appointment.googleEventId == "recovered-google-event"
    assert get_calls["n"] == 2
    await engine.dispose()
