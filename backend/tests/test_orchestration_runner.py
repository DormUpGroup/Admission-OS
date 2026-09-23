from datetime import UTC, datetime

from sqlalchemy import insert, select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.core.config import get_settings
from app.db.tables import (
    agent_run_table,
    conversation_message_table,
    conversation_table,
    lead_table,
    metadata,
)
from app.orchestration.runner import orchestrate_outbox_event


async def test_global_kill_switch_skips_hermes_without_losing_run_audit(
    monkeypatch,
) -> None:
    monkeypatch.setenv("AUTOMATION_ENABLED", "false")
    get_settings.cache_clear()
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    factory = async_sessionmaker(engine, expire_on_commit=False)
    async with engine.begin() as connection:
        await connection.run_sync(metadata.create_all)
    now = datetime.now(UTC)
    async with factory() as db:
        await db.execute(
            insert(lead_table).values(
                id="lead_1",
                status="NEW",
                source="TELEGRAM",
                consentStatus="UNKNOWN",
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
                createdAt=now,
                updatedAt=now,
            )
        )
        await db.execute(
            insert(conversation_message_table).values(
                id="message_1",
                conversationId="conversation_1",
                direction="INBOUND",
                senderType="CONTACT",
                body="Hello",
                deliveryStatus="RECEIVED",
                policyStatus="PENDING",
                createdAt=now,
                updatedAt=now,
            )
        )
        await db.commit()
    event = {
        "id": "event_1",
        "aggregateType": "Conversation",
        "aggregateId": "conversation_1",
        "eventType": "message.received.v1",
        "payloadJson": {
            "conversation_id": "conversation_1",
            "message_id": "message_1",
            "lead_id": "lead_1",
        },
        "idempotencyKey": "telegram:update:1",
    }
    async with factory() as db:
        async with db.begin():
            await orchestrate_outbox_event(db, event)
    async with factory() as db:
        run = (await db.execute(select(agent_run_table))).mappings().one()
    assert run.agentKey == "intake"
    assert run.status == "SKIPPED_DISABLED"
    assert run.hermesRunId is None
    get_settings.cache_clear()
    await engine.dispose()
