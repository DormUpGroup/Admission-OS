import json
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any
from uuid import uuid4

from sqlalchemy import insert, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.db.tables import (
    agent_definition_table,
    agent_run_table,
    conversation_message_table,
    conversation_table,
)
from app.mcp.capability import CapabilityError, mint_mcp_capability
from app.mcp.registry import scopes_for_tools
from app.orchestration.hermes_client import HermesClient, HermesRun
from app.orchestration.registry import agent_for_event, sync_agent_definitions
from app.orchestration.settings import automation_is_enabled


def _system_prompt(agent_key: str, mission: str, forbidden: tuple[str, ...]) -> str:
    restrictions = "\n".join(f"- {item}" for item in forbidden)
    return (
        f"You are the IMMIGROME {agent_key} specialist.\n"
        f"Mission: {mission}\n"
        "Postgres is authoritative. Use only configured IMMIGROME MCP tools. "
        "Never claim a write succeeded unless a tool confirms it. "
        "Return a structured decision, not chain-of-thought.\n"
        f"Forbidden:\n{restrictions}"
    )


@dataclass(frozen=True)
class PreparedAgentLaunch:
    run_id: str
    agent_key: str
    agent_version: str
    conversation_id: str | None
    lead_id: str | None
    student_id: str | None
    allowed_tools: tuple[str, ...]
    timeout_seconds: int
    hermes_session_id: str | None
    prompt: str | None
    hermes_idempotency_key: str
    already_launched: bool
    skipped: bool


def _prepared(
    *,
    run_id: str,
    agent_key: str,
    agent_version: str = "1.0.0",
    conversation_id: str | None,
    lead_id: str | None = None,
    student_id: str | None = None,
    allowed_tools: tuple[str, ...] | list[str] = (),
    timeout_seconds: int = 120,
    hermes_session_id: str | None,
    prompt: str | None,
    hermes_idempotency_key: str,
    already_launched: bool,
    skipped: bool,
) -> PreparedAgentLaunch:
    return PreparedAgentLaunch(
        run_id=run_id,
        agent_key=agent_key,
        agent_version=agent_version,
        conversation_id=conversation_id,
        lead_id=lead_id,
        student_id=student_id,
        allowed_tools=tuple(allowed_tools),
        timeout_seconds=timeout_seconds,
        hermes_session_id=hermes_session_id,
        prompt=prompt,
        hermes_idempotency_key=hermes_idempotency_key,
        already_launched=already_launched,
        skipped=skipped,
    )


async def prepare_agent_run(
    db: AsyncSession, event: dict[str, Any]
) -> PreparedAgentLaunch | None:
    """Persist AgentRun before any Hermes HTTP call.

    Returns None when the event should be ignored (no agent / paused conversation).
    """
    spec = agent_for_event(str(event["eventType"]))
    if spec is None:
        raise RuntimeError(f"No enabled agent route for {event['eventType']}")
    await sync_agent_definitions(db)
    definition = (
        await db.execute(
            select(agent_definition_table).where(
                agent_definition_table.c.key == spec.key
            )
        )
    ).mappings().one()
    existing = (
        await db.execute(
            select(agent_run_table).where(
                agent_run_table.c.idempotencyKey == event["idempotencyKey"]
            )
        )
    ).mappings().first()
    if existing and (
        existing.hermesRunId or existing.status == "SKIPPED_DISABLED"
    ):
        return _prepared(
            run_id=existing.id,
            agent_key=existing.agentKey,
            agent_version=definition.version,
            conversation_id=existing.conversationId,
            allowed_tools=definition.allowedToolsJson or [],
            timeout_seconds=int(definition.timeoutSeconds),
            hermes_session_id=existing.hermesSessionId,
            prompt=None,
            hermes_idempotency_key=event["idempotencyKey"],
            already_launched=True,
            skipped=existing.status == "SKIPPED_DISABLED",
        )

    payload = event["payloadJson"]
    conversation_id = payload.get("conversation_id")
    message_id = payload.get("message_id")
    message_text = None
    hermes_session_id = None
    lead_id = None
    student_id = None
    if conversation_id:
        conversation = (
            await db.execute(
                select(conversation_table).where(
                    conversation_table.c.id == conversation_id
                )
            )
        ).mappings().first()
        if conversation and conversation.automationPausedAt is not None:
            return None
        if conversation:
            hermes_session_id = conversation.hermesSessionId
            lead_id = conversation.leadId
            student_id = conversation.studentId
    if message_id:
        message_text = (
            await db.execute(
                select(conversation_message_table.c.body).where(
                    conversation_message_table.c.id == message_id
                )
            )
        ).scalar_one_or_none()

    allowed_tools = tuple(definition.allowedToolsJson or [])
    prompt = (
        _system_prompt(spec.key, spec.mission, spec.forbidden)
        + "\nEvent:\n"
        + json.dumps(
            {
                "event_type": event["eventType"],
                "conversation_id": conversation_id,
                "message_id": message_id,
                "message_text": message_text,
                "allowed_tools": list(allowed_tools),
                "output_schema": spec.output_schema,
            },
            ensure_ascii=False,
            default=str,
        )
    )

    if existing:
        return _prepared(
            run_id=existing.id,
            agent_key=existing.agentKey,
            agent_version=definition.version,
            conversation_id=existing.conversationId or conversation_id,
            lead_id=lead_id,
            student_id=student_id,
            allowed_tools=allowed_tools,
            timeout_seconds=int(definition.timeoutSeconds),
            hermes_session_id=existing.hermesSessionId or hermes_session_id,
            prompt=prompt,
            hermes_idempotency_key=event["idempotencyKey"],
            already_launched=False,
            skipped=False,
        )

    now = datetime.now(UTC)
    run_id = uuid4().hex
    enabled = await automation_is_enabled(db) and bool(definition.enabled)
    status = "STARTING" if enabled else "SKIPPED_DISABLED"
    await db.execute(
        insert(agent_run_table).values(
            id=run_id,
            agentKey=spec.key,
            conversationId=conversation_id,
            subjectType="Conversation" if conversation_id else event["aggregateType"],
            subjectId=conversation_id or event["aggregateId"],
            status=status,
            promptVersion=spec.prompt_version,
            policyVersion="v1",
            idempotencyKey=event["idempotencyKey"],
            inputJson={
                "event_type": event["eventType"],
                "payload": payload,
            },
            toolCallCount=0,
            startedAt=now if enabled else None,
            completedAt=now if not enabled else None,
            createdAt=now,
            updatedAt=now,
        )
    )
    if not enabled:
        return _prepared(
            run_id=run_id,
            agent_key=spec.key,
            agent_version=definition.version,
            conversation_id=conversation_id,
            lead_id=lead_id,
            student_id=student_id,
            allowed_tools=allowed_tools,
            timeout_seconds=int(definition.timeoutSeconds),
            hermes_session_id=hermes_session_id,
            prompt=None,
            hermes_idempotency_key=event["idempotencyKey"],
            already_launched=True,
            skipped=True,
        )

    return _prepared(
        run_id=run_id,
        agent_key=spec.key,
        agent_version=definition.version,
        conversation_id=conversation_id,
        lead_id=lead_id,
        student_id=student_id,
        allowed_tools=allowed_tools,
        timeout_seconds=int(definition.timeoutSeconds),
        hermes_session_id=hermes_session_id,
        prompt=prompt,
        hermes_idempotency_key=event["idempotencyKey"],
        already_launched=False,
        skipped=False,
    )


def _mint_run_capability(prepared: PreparedAgentLaunch) -> str:
    settings = get_settings()
    if not settings.hermes_mcp_capability_secret:
        raise CapabilityError("HERMES_MCP_CAPABILITY_SECRET is not configured")
    # Import tools so registry scopes resolve for allowed tools.
    from app.mcp import tools as _tools  # noqa: F401

    return mint_mcp_capability(
        secret=settings.hermes_mcp_capability_secret,
        agent_run_id=prepared.run_id,
        agent_key=prepared.agent_key,
        agent_version=prepared.agent_version,
        allowed_tools=prepared.allowed_tools,
        allowed_scopes=scopes_for_tools(prepared.allowed_tools),
        timeout_seconds=prepared.timeout_seconds,
        student_id=prepared.student_id,
        lead_id=prepared.lead_id,
        conversation_id=prepared.conversation_id,
        correlation_id=prepared.hermes_idempotency_key,
    )


async def launch_hermes_run(prepared: PreparedAgentLaunch) -> HermesRun:
    if prepared.prompt is None:
        raise RuntimeError("Prepared launch has no prompt")
    mcp_authorization = _mint_run_capability(prepared)
    return await HermesClient(get_settings()).create_run(
        prompt=prepared.prompt,
        idempotency_key=prepared.hermes_idempotency_key,
        session_id=prepared.hermes_session_id,
        metadata={
            "agent_key": prepared.agent_key,
            "immigrome_agent_run_id": prepared.run_id,
            "conversation_id": prepared.conversation_id,
        },
        mcp_authorization=mcp_authorization,
    )


async def finalize_agent_run(
    db: AsyncSession,
    *,
    prepared: PreparedAgentLaunch,
    hermes_run: HermesRun,
) -> None:
    now = datetime.now(UTC)
    await db.execute(
        update(agent_run_table)
        .where(agent_run_table.c.id == prepared.run_id)
        .values(
            status=hermes_run.status.upper(),
            hermesRunId=hermes_run.id,
            hermesSessionId=hermes_run.session_id,
            outputJson=hermes_run.output,
            updatedAt=now,
        )
    )
    if prepared.conversation_id and hermes_run.session_id:
        await db.execute(
            update(conversation_table)
            .where(conversation_table.c.id == prepared.conversation_id)
            .values(hermesSessionId=hermes_run.session_id, updatedAt=now)
        )


async def orchestrate_outbox_event(
    db: AsyncSession, event: dict[str, Any]
) -> None:
    """Prepare-only path for tests and non-Hermes callers.

    Production workers must use prepare → Hermes HTTP outside txn → finalize.
    """
    await prepare_agent_run(db, event)
