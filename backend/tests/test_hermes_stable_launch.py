import json
from datetime import UTC, datetime, timedelta
from types import SimpleNamespace

from sqlalchemy import func, insert, select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.core.config import get_settings
from app.db.tables import (
    agent_run_table,
    automation_setting_table,
    conversation_message_table,
    conversation_table,
    lead_table,
    metadata,
    outbox_event_table,
)
from app.events.outbox import claim_events
from app.orchestration import runner as runner_module
from app.orchestration.hermes_client import HermesRun
from app.workers import outbox as outbox_module


async def _seed(factory) -> dict:
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
                version=1,
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
        await db.execute(
            insert(automation_setting_table).values(
                key="global_enabled",
                valueJson={"enabled": True},
                updatedAt=now,
            )
        )
        await db.execute(
            insert(outbox_event_table).values(
                id="event_1",
                aggregateType="Conversation",
                aggregateId="conversation_1",
                eventType="message.received.v1",
                eventVersion=1,
                payloadJson={
                    "conversation_id": "conversation_1",
                    "message_id": "message_1",
                    "lead_id": "lead_1",
                },
                status="PENDING",
                attempts=0,
                maxAttempts=8,
                nextAttemptAt=now,
                idempotencyKey="telegram:update:stable-1",
                createdAt=now,
                updatedAt=now,
            )
        )
        await db.commit()
    return {
        "id": "event_1",
        "aggregateType": "Conversation",
        "aggregateId": "conversation_1",
        "eventType": "message.received.v1",
        "payloadJson": {
            "conversation_id": "conversation_1",
            "message_id": "message_1",
            "lead_id": "lead_1",
        },
        "idempotencyKey": "telegram:update:stable-1",
        "attempts": 0,
        "maxAttempts": 8,
    }


async def test_hermes_retry_reuses_stable_idempotency_key(monkeypatch) -> None:
    monkeypatch.setenv("AUTOMATION_ENABLED", "true")
    get_settings.cache_clear()
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    factory = async_sessionmaker(engine, expire_on_commit=False)
    async with engine.begin() as connection:
        await connection.run_sync(metadata.create_all)
    await _seed(factory)
    hermes_keys: list[str] = []

    async def fail_then_succeed(prepared):
        hermes_keys.append(prepared.hermes_idempotency_key)
        if len(hermes_keys) == 1:
            raise RuntimeError("finalize crashed after Hermes accepted")
        return HermesRun(
            id="hermes_run_1",
            status="queued",
            session_id="session_1",
        )

    monkeypatch.setattr(outbox_module, "launch_hermes_run", fail_then_succeed)

    async with factory() as db:
        async with db.begin():
            claimed = await claim_events(db, worker_id="worker-1", now=datetime.now(UTC))
    assert len(claimed) == 1

    first = await outbox_module._dispatch_orchestration_event(factory, claimed[0])
    assert first == "FAILED"
    assert hermes_keys == ["telegram:update:stable-1"]

    async with factory() as db:
        runs = (await db.execute(select(agent_run_table))).mappings().all()
        outbox = (
            await db.execute(
                select(outbox_event_table).where(outbox_event_table.c.id == "event_1")
            )
        ).mappings().one()
    assert len(runs) == 1
    assert runs[0].hermesRunId is None
    assert outbox.status == "PENDING"

    async with factory() as db:
        async with db.begin():
            reclaimed = await claim_events(
                db,
                worker_id="worker-1",
                now=datetime.now(UTC) + timedelta(seconds=30),
            )
    assert len(reclaimed) == 1

    second = await outbox_module._dispatch_orchestration_event(factory, reclaimed[0])
    assert second == "PROCESSED"
    assert hermes_keys == [
        "telegram:update:stable-1",
        "telegram:update:stable-1",
    ]

    async with factory() as db:
        run_count = (
            await db.execute(select(func.count()).select_from(agent_run_table))
        ).scalar_one()
        run = (await db.execute(select(agent_run_table))).mappings().one()
    assert run_count == 1
    assert run.hermesRunId == "hermes_run_1"
    get_settings.cache_clear()
    await engine.dispose()


async def test_hermes_finalize_failure_after_success_retries_same_key(
    monkeypatch,
) -> None:
    monkeypatch.setenv("AUTOMATION_ENABLED", "true")
    get_settings.cache_clear()
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    factory = async_sessionmaker(engine, expire_on_commit=False)
    async with engine.begin() as connection:
        await connection.run_sync(metadata.create_all)
    await _seed(factory)
    hermes_keys: list[str] = []
    finalize_calls = {"n": 0}
    real_finalize = outbox_module.finalize_agent_run

    async def always_succeed(prepared):
        hermes_keys.append(prepared.hermes_idempotency_key)
        return HermesRun(id="hermes_run_2", status="queued", session_id="session_2")

    async def fail_finalize_once(db, **kwargs):
        finalize_calls["n"] += 1
        if finalize_calls["n"] == 1:
            raise RuntimeError("db finalize crashed")
        return await real_finalize(db, **kwargs)

    monkeypatch.setattr(outbox_module, "launch_hermes_run", always_succeed)
    monkeypatch.setattr(outbox_module, "finalize_agent_run", fail_finalize_once)

    async with factory() as db:
        async with db.begin():
            claimed = await claim_events(db, worker_id="worker-1", now=datetime.now(UTC))
    first = await outbox_module._dispatch_orchestration_event(factory, claimed[0])
    assert first == "FAILED"
    assert hermes_keys == ["telegram:update:stable-1"]

    async with factory() as db:
        async with db.begin():
            reclaimed = await claim_events(
                db,
                worker_id="worker-1",
                now=datetime.now(UTC) + timedelta(seconds=30),
            )
    second = await outbox_module._dispatch_orchestration_event(factory, reclaimed[0])
    assert second == "PROCESSED"
    assert hermes_keys == [
        "telegram:update:stable-1",
        "telegram:update:stable-1",
    ]
    get_settings.cache_clear()
    await engine.dispose()


async def test_launch_hermes_uses_outbox_idempotency_key(monkeypatch) -> None:
    seen: dict[str, object] = {}
    monkeypatch.setenv(
        "HERMES_MCP_CAPABILITY_SECRET",
        "capability-secret-that-is-longer-than-thirty-two-bytes",
    )
    get_settings.cache_clear()

    class FakeClient:
        def __init__(self, *_args, **_kwargs):
            pass

        async def create_run(self, **kwargs):
            seen["key"] = kwargs["idempotency_key"]
            seen["mcp_authorization"] = kwargs.get("mcp_authorization")
            seen["metadata"] = kwargs.get("metadata")
            return HermesRun(id="h1", status="queued", session_id=None)

    monkeypatch.setattr(runner_module, "HermesClient", FakeClient)
    prepared = SimpleNamespace(
        prompt="prompt",
        hermes_idempotency_key="telegram:update:stable-2",
        hermes_session_id=None,
        agent_key="intake",
        agent_version="1.0.0",
        run_id="run_1",
        conversation_id="conversation_1",
        lead_id="lead_1",
        student_id=None,
        allowed_tools=("lead.get",),
        timeout_seconds=120,
    )
    run = await runner_module.launch_hermes_run(prepared)  # type: ignore[arg-type]
    assert run.id == "h1"
    assert seen["key"] == "telegram:update:stable-2"
    assert isinstance(seen["mcp_authorization"], str)
    assert seen["mcp_authorization"] not in json.dumps(seen["metadata"])
    get_settings.cache_clear()
