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
from app.observability.metrics import get_counts, reset_counts
from app.services.delivery import google_calendar, telegram
from app.services.delivery.google_calendar import deterministic_google_event_id


async def _database():
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    async with engine.begin() as connection:
        await connection.run_sync(metadata.create_all)
    return engine, async_sessionmaker(engine, expire_on_commit=False)


async def _seed_telegram_message(db, *, suffix: str = "1") -> None:
    now = datetime.now(UTC)
    await db.execute(
        insert(lead_table).values(
            id=f"lead_{suffix}",
            status="QUALIFYING",
            source="TELEGRAM",
            consentStatus="GRANTED",
            createdAt=now,
            updatedAt=now,
        )
    )
    await db.execute(
        insert(conversation_table).values(
            id=f"conversation_{suffix}",
            channel="TELEGRAM",
            status="OPEN",
            leadId=f"lead_{suffix}",
            version=1,
            createdAt=now,
            updatedAt=now,
        )
    )
    await db.execute(
        insert(conversation_message_table).values(
            id=f"message_{suffix}",
            conversationId=f"conversation_{suffix}",
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
            id=f"identity_{suffix}",
            channel="TELEGRAM",
            externalId=f"900{suffix}",
            leadId=f"lead_{suffix}",
            metadataJson={"chat_id": f"900{suffix}"},
            createdAt=now,
            updatedAt=now,
        )
    )


async def test_telegram_timeout_requires_review_and_does_not_retry(
    monkeypatch,
) -> None:
    engine, factory = await _database()
    reset_counts()

    async def timeout(*_args, **_kwargs):
        raise httpx.TimeoutException("telegram send timed out")

    monkeypatch.setattr(telegram.TelegramAdapter, "send_text", timeout)
    async with factory() as db:
        async with db.begin():
            await _seed_telegram_message(db, suffix="1")
            prepared = await telegram.prepare_telegram_delivery(
                db,
                {
                    "id": "outbox_1",
                    "idempotencyKey": "message:send:key-1",
                    "payloadJson": {"message_id": "message_1"},
                },
            )
        assert prepared.action == "send"
        try:
            await telegram.call_telegram_delivery(prepared)
            raise AssertionError("expected timeout")
        except httpx.TimeoutException as error:
            async with factory() as db:
                async with db.begin():
                    outcome = await telegram.finalize_telegram_delivery(
                        db, prepared, error=error
                    )
        async with factory() as db:
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
    assert outcome == "unknown"
    assert message.deliveryStatus == "UNKNOWN_REQUIRES_REVIEW"
    assert attempt.status == "UNKNOWN_REQUIRES_REVIEW"
    assert get_counts().get("unknown_delivery|provider=TELEGRAM", 0) >= 1
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
            await _seed_telegram_message(db, suffix="timeout")
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
                db,
                event,
                {"message.send.requested.v1": telegram.deliver_telegram_message},
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


async def test_telegram_prepare_does_not_resend_after_processing(
    monkeypatch,
) -> None:
    engine, factory = await _database()
    sends: list[str] = []

    async def send_text(self, chat_id, text, *, idempotency_key):
        sends.append(chat_id)
        return "tg-1"

    monkeypatch.setattr(telegram.TelegramAdapter, "send_text", send_text)
    async with factory() as db:
        async with db.begin():
            await _seed_telegram_message(db, suffix="prep")
            prepared = await telegram.prepare_telegram_delivery(
                db,
                {
                    "id": "outbox_prep",
                    "idempotencyKey": "key-prep",
                    "payloadJson": {"message_id": "message_prep"},
                },
            )
            assert prepared.action == "send"
            assert prepared.attempt_id is not None
    # Simulate reclaim after prepare committed, call never finalized.
    async with factory() as db:
        async with db.begin():
            reclaim = await telegram.prepare_telegram_delivery(
                db,
                {
                    "id": "outbox_prep",
                    "idempotencyKey": "key-prep",
                    "payloadJson": {"message_id": "message_prep"},
                },
            )
            assert reclaim.action == "skip_unknown"
            attempt = (
                await db.execute(select(delivery_attempt_table))
            ).mappings().one()
            message = (
                await db.execute(
                    select(conversation_message_table).where(
                        conversation_message_table.c.id == "message_prep"
                    )
                )
            ).mappings().one()
    assert attempt.status == "UNKNOWN_REQUIRES_REVIEW"
    assert message.deliveryStatus == "UNKNOWN_REQUIRES_REVIEW"
    assert sends == []
    await engine.dispose()


async def test_google_calendar_reuses_event_found_by_appointment_id(
    monkeypatch,
) -> None:
    """Secondary recovery via immigromeAppointmentId when deterministic GET misses."""
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
    provider_id = deterministic_google_event_id("appointment_1")

    def handler(request: httpx.Request) -> httpx.Response:
        calls.append(request.method)
        path = str(request.url)
        if request.method == "POST":
            return httpx.Response(409, json={"error": {"code": 409}})
        if request.method == "GET" and provider_id in path:
            return httpx.Response(404, json={"error": {"code": 404}})
        if request.method == "GET":
            assert "immigromeAppointmentId%3Dappointment_1" in path
            return httpx.Response(
                200, json={"items": [{"id": "existing-google-event"}]}
            )
        return httpx.Response(500, json={"error": "unexpected"})

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
            prepared = await google_calendar.prepare_google_calendar_event(
                db, {"payloadJson": {"appointment_id": "appointment_1"}}
            )
        assert prepared.action == "create"
        assert prepared.provider_event_id == provider_id
        result = await google_calendar.call_google_calendar_event(prepared)
        async with factory() as db:
            async with db.begin():
                await google_calendar.finalize_google_calendar_event(
                    db, prepared, result=result
                )
        async with factory() as db:
            appointment = (
                await db.execute(
                    select(appointment_table).where(
                        appointment_table.c.id == "appointment_1"
                    )
                )
            ).mappings().one()
    assert appointment.googleEventId == "existing-google-event"
    assert calls[0] == "POST"
    assert "GET" in calls
    await engine.dispose()


async def test_google_calendar_409_recovers_via_deterministic_id(
    monkeypatch,
) -> None:
    engine, factory = await _database()
    now = datetime.now(UTC)
    starts = now + timedelta(days=1)
    appointment_id = "appointment_409"
    provider_id = deterministic_google_event_id(appointment_id)
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

    def handler(request: httpx.Request) -> httpx.Response:
        if request.method == "POST":
            body = request.read()
            assert provider_id.encode() in body
            return httpx.Response(409, json={"error": {"code": 409}})
        if request.method == "GET" and provider_id in str(request.url):
            return httpx.Response(200, json={"id": provider_id})
        return httpx.Response(500, json={"error": "should not search"})

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
                    id="lead_409",
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
                    clientRequestId="appointment-request-409",
                    leadId="lead_409",
                    title="Conflict call",
                    startsAt=starts,
                    endsAt=starts + timedelta(minutes=30),
                    timezone="Europe/Rome",
                    status="PENDING",
                    createdAt=now,
                    updatedAt=now,
                )
            )
            prepared = await google_calendar.prepare_google_calendar_event(
                db, {"payloadJson": {"appointment_id": appointment_id}}
            )
        result = await google_calendar.call_google_calendar_event(prepared)
        async with factory() as db:
            async with db.begin():
                await google_calendar.finalize_google_calendar_event(
                    db, prepared, result=result
                )
            appointment = (
                await db.execute(
                    select(appointment_table).where(
                        appointment_table.c.id == appointment_id
                    )
                )
            ).mappings().one()
    assert appointment.googleEventId == provider_id
    await engine.dispose()


async def test_google_calendar_timeout_after_create_recovers_via_get(
    monkeypatch,
) -> None:
    engine, factory = await _database()
    now = datetime.now(UTC)
    starts = now + timedelta(days=1)
    appointment_id = "appointment_2"
    provider_id = deterministic_google_event_id(appointment_id)
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

    def handler(request: httpx.Request) -> httpx.Response:
        if request.method == "POST":
            raise httpx.TimeoutException("create timed out")
        if request.method == "GET" and provider_id in str(request.url):
            return httpx.Response(200, json={"id": provider_id})
        return httpx.Response(200, json={"items": []})

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
                    id=appointment_id,
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
            prepared = await google_calendar.prepare_google_calendar_event(
                db, {"payloadJson": {"appointment_id": appointment_id}}
            )
        result = await google_calendar.call_google_calendar_event(prepared)
        async with factory() as db:
            async with db.begin():
                await google_calendar.finalize_google_calendar_event(
                    db, prepared, result=result
                )
            appointment = (
                await db.execute(
                    select(appointment_table).where(
                        appointment_table.c.id == appointment_id
                    )
                )
            ).mappings().one()
    assert appointment.googleEventId == provider_id
    await engine.dispose()


async def test_telegram_http_outside_active_transaction(monkeypatch) -> None:
    """call_telegram_delivery must not require / hold a DB session."""
    engine, factory = await _database()
    sessions_during_http: list[bool] = []

    async def send_text(self, chat_id, text, *, idempotency_key):
        # Structural: call path has no session argument; nothing in transaction.
        sessions_during_http.append(True)
        return "99"

    monkeypatch.setattr(telegram.TelegramAdapter, "send_text", send_text)
    async with factory() as db:
        async with db.begin():
            await _seed_telegram_message(db, suffix="http")
            prepared = await telegram.prepare_telegram_delivery(
                db,
                {
                    "id": "outbox_http",
                    "idempotencyKey": "key-http",
                    "payloadJson": {"message_id": "message_http"},
                },
            )
    # Session/txn closed before HTTP.
    result = await telegram.call_telegram_delivery(prepared)
    assert result.provider_message_id == "99"
    assert sessions_during_http == [True]
    assert call_telegram_delivery_has_no_session_param()
    await engine.dispose()


def call_telegram_delivery_has_no_session_param() -> bool:
    import inspect

    params = inspect.signature(telegram.call_telegram_delivery).parameters
    return "db" not in params and "session" not in params
