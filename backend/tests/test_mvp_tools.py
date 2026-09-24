from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy import func, insert, select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.db.tables import (
    appointment_table,
    approval_request_table,
    conversation_table,
    lead_table,
    metadata,
    outbox_event_table,
    user_table,
)
from app.mcp.principal import McpPrincipal
from app.mcp.tools import (
    appointment_create,
    message_propose,
    message_request_send,
)


def _lead_principal(lead_id: str = "lead_1") -> McpPrincipal:
    return McpPrincipal(
        agent_run_id="run_test",
        agent_key="scheduling",
        agent_version="1.0.0",
        allowed_tools=frozenset({"appointment.create"}),
        allowed_scopes=frozenset({"appointments:write"}),
        lead_id=lead_id,
    )


def _conversation_principal(
    conversation_id: str, agent_key: str = "intake"
) -> McpPrincipal:
    return McpPrincipal(
        agent_run_id="run_test",
        agent_key=agent_key,
        agent_version="1.0.0",
        allowed_tools=frozenset({"message.propose", "message.request_send"}),
        allowed_scopes=frozenset({"messages:draft", "messages:send"}),
        conversation_id=conversation_id,
        lead_id="lead_2",
    )


async def _database():
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    async with engine.begin() as connection:
        await connection.run_sync(metadata.create_all)
    return engine, async_sessionmaker(engine, expire_on_commit=False)


async def test_appointment_creation_is_idempotent_and_rejects_overlap() -> None:
    engine, factory = await _database()
    now = datetime.now(UTC)
    starts = now + timedelta(days=2)
    ends = starts + timedelta(minutes=45)
    async with factory() as db:
        await db.execute(
            insert(user_table).values(
                id="curator_1",
                name="Curator",
                role="CURATOR",
            )
        )
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
        await db.commit()
    arguments = {
        "curator_id": "curator_1",
        "lead_id": "lead_1",
        "starts_at": starts.isoformat(),
        "ends_at": ends.isoformat(),
        "idempotency_key": "appointment_request_1",
    }
    async with factory() as db:
        async with db.begin():
            first = await appointment_create(db, arguments, _lead_principal())
    async with factory() as db:
        async with db.begin():
            replay = await appointment_create(db, arguments, _lead_principal())
    assert replay["appointment_id"] == first["appointment_id"]

    async with factory() as db:
        with pytest.raises(ValueError, match="no longer available"):
            async with db.begin():
                await appointment_create(
                    db,
                    {**arguments, "idempotency_key": "appointment_request_2"},
                    _lead_principal(),
                )
    async with factory() as db:
        count = (
            await db.execute(select(func.count()).select_from(appointment_table))
        ).scalar_one()
    assert count == 1
    await engine.dispose()


async def test_outbound_free_form_requires_approval_but_template_is_queued() -> None:
    engine, factory = await _database()
    now = datetime.now(UTC)
    async with factory() as db:
        await db.execute(
            insert(lead_table).values(
                id="lead_2",
                status="QUALIFYING",
                source="TELEGRAM",
                consentStatus="GRANTED",
                createdAt=now,
                updatedAt=now,
            )
        )
        await db.execute(
            insert(conversation_table).values(
                id="conversation_2",
                channel="TELEGRAM",
                status="OPEN",
                leadId="lead_2",
                createdAt=now,
                updatedAt=now,
            )
        )
        await db.commit()
    async with factory() as db:
        async with db.begin():
            draft = await message_propose(
                db,
                {
                    "conversation_id": "conversation_2",
                    "text": "Расскажите, пожалуйста, о ваших целях.",
                    "idempotency_key": "draft_1",
                },
                _conversation_principal("conversation_2", "intake"),
            )
            result = await message_request_send(
                db,
                {
                    "message_id": draft["message_id"],
                    "idempotency_key": "send_1",
                },
                _conversation_principal("conversation_2", "intake"),
            )
    assert result["status"] == "APPROVAL_REQUIRED"

    async with factory() as db:
        async with db.begin():
            template_draft = await message_propose(
                db,
                {
                    "conversation_id": "conversation_2",
                    "text": "Напоминаем о недостающем документе.",
                    "idempotency_key": "draft_2",
                },
                _conversation_principal("conversation_2", "follow_up"),
            )
            queued = await message_request_send(
                db,
                {
                    "message_id": template_draft["message_id"],
                    "idempotency_key": "send_2",
                    "template_key": "document-reminder-v1",
                },
                _conversation_principal("conversation_2", "follow_up"),
            )
    assert queued["status"] == "QUEUED"
    async with factory() as db:
        approvals = (
            await db.execute(select(func.count()).select_from(approval_request_table))
        ).scalar_one()
        outbox = (
            await db.execute(select(func.count()).select_from(outbox_event_table))
        ).scalar_one()
    assert approvals == 1
    assert outbox == 1
    await engine.dispose()
