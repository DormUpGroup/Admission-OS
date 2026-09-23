import asyncio

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.core.config import get_settings
from app.db.session import get_db_session
from app.db.tables import (
    conversation_message_table,
    conversation_table,
    lead_table,
    metadata,
    outbox_event_table,
)
from app.main import app


@pytest.fixture
def telegram_client(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setenv("TELEGRAM_WEBHOOK_SECRET", "telegram-test-secret")
    get_settings.cache_clear()
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    factory = async_sessionmaker(engine, expire_on_commit=False)

    async def create_schema():
        async with engine.begin() as connection:
            await connection.run_sync(metadata.create_all)

    asyncio.run(create_schema())

    async def override_db():
        async with factory() as session:
            yield session

    app.dependency_overrides[get_db_session] = override_db
    try:
        with TestClient(app) as client:
            yield client, factory
    finally:
        app.dependency_overrides.pop(get_db_session, None)
        get_settings.cache_clear()
        asyncio.run(engine.dispose())


def test_telegram_webhook_persists_before_orchestration_and_deduplicates(
    telegram_client,
) -> None:
    client, factory = telegram_client
    update = {
        "update_id": 1001,
        "message": {
            "message_id": 41,
            "from": {
                "id": 9001,
                "first_name": "Alina",
                "last_name": "Sokolova",
                "username": "alina",
            },
            "chat": {"id": 9001, "type": "private"},
            "text": "Хочу поступать в Италию",
        },
    }
    headers = {"X-Telegram-Bot-Api-Secret-Token": "telegram-test-secret"}
    first = client.post("/webhooks/telegram", json=update, headers=headers)
    second = client.post("/webhooks/telegram", json=update, headers=headers)

    assert first.status_code == 202
    assert first.json()["duplicate"] is False
    assert second.status_code == 202
    assert second.json()["duplicate"] is True

    async def counts():
        async with factory() as db:
            return [
                (
                    await db.execute(select(func.count()).select_from(table))
                ).scalar_one()
                for table in (
                    lead_table,
                    conversation_table,
                    conversation_message_table,
                    outbox_event_table,
                )
            ]

    assert asyncio.run(counts()) == [1, 1, 1, 1]


def test_telegram_stop_pauses_automation_without_creating_agent_event(
    telegram_client,
) -> None:
    client, factory = telegram_client
    update = {
        "update_id": 1002,
        "message": {
            "message_id": 42,
            "from": {"id": 9002, "first_name": "Boris"},
            "chat": {"id": 9002, "type": "private"},
            "text": "/stop",
        },
    }
    response = client.post(
        "/webhooks/telegram",
        json=update,
        headers={"X-Telegram-Bot-Api-Secret-Token": "telegram-test-secret"},
    )
    assert response.status_code == 202
    assert response.json()["automation_paused"] is True

    async def state():
        async with factory() as db:
            lead = (await db.execute(select(lead_table))).mappings().one()
            conversation = (
                await db.execute(select(conversation_table))
            ).mappings().one()
            outbox_count = (
                await db.execute(select(func.count()).select_from(outbox_event_table))
            ).scalar_one()
            return lead, conversation, outbox_count

    lead, conversation, outbox_count = asyncio.run(state())
    assert lead.consentStatus == "WITHDRAWN"
    assert conversation.automationPauseReason == "CONTACT_OPT_OUT"
    assert outbox_count == 0


def test_telegram_rejects_wrong_webhook_secret(telegram_client) -> None:
    client, _ = telegram_client
    response = client.post(
        "/webhooks/telegram",
        headers={"X-Telegram-Bot-Api-Secret-Token": "wrong"},
        json={"update_id": 1},
    )
    assert response.status_code == 401


def test_telegram_message_burst_keeps_one_identity_and_conversation(
    telegram_client,
) -> None:
    client, factory = telegram_client
    headers = {"X-Telegram-Bot-Api-Secret-Token": "telegram-test-secret"}
    for index in range(30):
        response = client.post(
            "/webhooks/telegram",
            headers=headers,
            json={
                "update_id": 2000 + index,
                "message": {
                    "message_id": 100 + index,
                    "from": {"id": 777, "first_name": "Load"},
                    "chat": {"id": 777, "type": "private"},
                    "text": f"Message {index}",
                },
            },
        )
        assert response.status_code == 202

    async def counts():
        async with factory() as db:
            return [
                (
                    await db.execute(select(func.count()).select_from(table))
                ).scalar_one()
                for table in (
                    lead_table,
                    conversation_table,
                    conversation_message_table,
                    outbox_event_table,
                )
            ]

    assert asyncio.run(counts()) == [1, 1, 30, 30]
