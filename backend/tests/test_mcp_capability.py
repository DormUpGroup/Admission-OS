from __future__ import annotations

import asyncio
from datetime import UTC, datetime, timedelta
from typing import Any

import jwt
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import insert, update
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.core.config import get_settings
from app.db.session import get_db_session
from app.db.tables import (
    agent_definition_table,
    agent_run_table,
    conversation_table,
    lead_table,
    metadata,
)
from app.main import app
from app.mcp.capability import (
    CAPABILITY_AUDIENCE,
    CAPABILITY_ISSUER,
    mint_mcp_capability,
)
from app.mcp.principal import McpPrincipal
from app.mcp.registry import invoke_tool
from app.orchestration.hermes_client import HermesClient

CAPABILITY_SECRET = "capability-secret-that-is-longer-than-thirty-two-bytes"
BOOTSTRAP_KEY = "bootstrap-mcp-key-value"
SEED_NOW = datetime(2026, 9, 23, 12, 0, tzinfo=UTC)


def _principal(**overrides: Any) -> McpPrincipal:
    data = {
        "agent_run_id": "run_intake_1",
        "agent_key": "intake",
        "agent_version": "1.0.0",
        "allowed_tools": frozenset({"lead.get", "lead.update_qualification"}),
        "allowed_scopes": frozenset({"leads:read", "leads:write"}),
        "lead_id": "lead_1",
        "conversation_id": "conversation_1",
        "student_id": None,
        "correlation_id": "corr_1",
        "jti": "jti_1",
    }
    data.update(overrides)
    return McpPrincipal(**data)


@pytest.fixture
def mcp_env(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setenv("HERMES_MCP_KEY", BOOTSTRAP_KEY)
    monkeypatch.setenv("HERMES_MCP_CAPABILITY_SECRET", CAPABILITY_SECRET)
    get_settings.cache_clear()
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    factory = async_sessionmaker(engine, expire_on_commit=False)

    async def create_schema():
        async with engine.begin() as connection:
            await connection.run_sync(metadata.create_all)

    asyncio.run(create_schema())

    async def seed():
        async with factory() as db:
            async with db.begin():
                await db.execute(
                    insert(agent_definition_table).values(
                        key="intake",
                        version="1.0.0",
                        enabled=True,
                        autonomyLevel="LOW_RISK_AUTONOMY",
                        allowedToolsJson=[
                            "lead.get",
                            "lead.update_qualification",
                            "conversation.get_recent",
                            "message.propose",
                            "message.request_send",
                            "scheduling.request",
                        ],
                        eventTypesJson=["message.received.v1"],
                        approvalPolicyJson={},
                        promptVersion="v1",
                        maxIterations=8,
                        timeoutSeconds=120,
                        createdAt=SEED_NOW,
                        updatedAt=SEED_NOW,
                    )
                )
                await db.execute(
                    insert(agent_definition_table).values(
                        key="document",
                        version="1.0.0",
                        enabled=True,
                        autonomyLevel="CONDITIONAL_AUTONOMY",
                        allowedToolsJson=[
                            "document.list_gaps",
                            "document.request",
                            "case.get_snapshot",
                            "task.create",
                        ],
                        eventTypesJson=["document.gap.detected.v1"],
                        approvalPolicyJson={},
                        promptVersion="v1",
                        maxIterations=8,
                        timeoutSeconds=120,
                        createdAt=SEED_NOW,
                        updatedAt=SEED_NOW,
                    )
                )
                await db.execute(
                    insert(lead_table).values(
                        id="lead_1",
                        status="QUALIFYING",
                        source="TELEGRAM",
                        consentStatus="GRANTED",
                        createdAt=SEED_NOW,
                        updatedAt=SEED_NOW,
                    )
                )
                await db.execute(
                    insert(lead_table).values(
                        id="lead_other",
                        status="QUALIFYING",
                        source="TELEGRAM",
                        consentStatus="GRANTED",
                        createdAt=SEED_NOW,
                        updatedAt=SEED_NOW,
                    )
                )
                await db.execute(
                    insert(conversation_table).values(
                        id="conversation_1",
                        channel="TELEGRAM",
                        status="OPEN",
                        leadId="lead_1",
                        createdAt=SEED_NOW,
                        updatedAt=SEED_NOW,
                    )
                )
                await db.execute(
                    insert(conversation_table).values(
                        id="conversation_other",
                        channel="TELEGRAM",
                        status="OPEN",
                        leadId="lead_other",
                        createdAt=SEED_NOW,
                        updatedAt=SEED_NOW,
                    )
                )
                await db.execute(
                    insert(agent_run_table).values(
                        id="run_intake_1",
                        agentKey="intake",
                        conversationId="conversation_1",
                        subjectType="Conversation",
                        subjectId="conversation_1",
                        status="RUNNING",
                        promptVersion="v1",
                        policyVersion="v1",
                        idempotencyKey="idem_intake_1",
                        toolCallCount=0,
                        startedAt=SEED_NOW,
                        createdAt=SEED_NOW,
                        updatedAt=SEED_NOW,
                    )
                )
                await db.execute(
                    insert(agent_run_table).values(
                        id="run_document_1",
                        agentKey="document",
                        conversationId="conversation_1",
                        subjectType="Conversation",
                        subjectId="conversation_1",
                        status="RUNNING",
                        promptVersion="v1",
                        policyVersion="v1",
                        idempotencyKey="idem_document_1",
                        toolCallCount=0,
                        startedAt=SEED_NOW,
                        createdAt=SEED_NOW,
                        updatedAt=SEED_NOW,
                    )
                )

    asyncio.run(seed())

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


def _mint(
    *,
    agent_run_id: str = "run_intake_1",
    agent_key: str = "intake",
    allowed_tools: list[str] | None = None,
    allowed_scopes: list[str] | None = None,
    lead_id: str | None = "lead_1",
    conversation_id: str | None = "conversation_1",
    student_id: str | None = None,
    secret: str = CAPABILITY_SECRET,
    expires_delta: timedelta = timedelta(minutes=20),
    iss: str = CAPABILITY_ISSUER,
    aud: str = CAPABILITY_AUDIENCE,
    **extra: Any,
) -> str:
    if allowed_tools is None:
        allowed_tools = ["lead.get", "lead.update_qualification", "conversation.get_recent"]
    if allowed_scopes is None:
        allowed_scopes = ["leads:read", "leads:write", "cases:read"]
    issued_at = datetime.now(UTC)
    claims: dict[str, Any] = {
        "iss": iss,
        "aud": aud,
        "iat": issued_at,
        "exp": issued_at + expires_delta,
        "jti": extra.pop("jti", "jti_test"),
        "agent_run_id": agent_run_id,
        "agent_key": agent_key,
        "agent_version": "1.0.0",
        "allowed_tools": allowed_tools,
        "allowed_scopes": allowed_scopes,
        "correlation_id": "corr_test",
    }
    if lead_id:
        claims["lead_id"] = lead_id
    if conversation_id:
        claims["conversation_id"] = conversation_id
    if student_id:
        claims["student_id"] = student_id
    claims.update(extra)
    return jwt.encode(claims, secret, algorithm="HS256")


def _call(
    client: TestClient,
    *,
    token: str,
    method: str,
    params: dict[str, Any] | None = None,
    request_id: int = 1,
):
    payload: dict[str, Any] = {"jsonrpc": "2.0", "id": request_id, "method": method}
    if params is not None:
        payload["params"] = params
    return client.post(
        "/mcp",
        headers={"Authorization": f"Bearer {token}"},
        json=payload,
    )


def test_1_valid_capability_allows_only_permitted_tool(mcp_env) -> None:
    client, _ = mcp_env
    token = _mint(allowed_tools=["lead.get"], allowed_scopes=["leads:read"])
    allowed = _call(
        client,
        token=token,
        method="tools/call",
        params={"name": "lead.get", "arguments": {"lead_id": "lead_1"}},
    )
    denied = _call(
        client,
        token=token,
        method="tools/call",
        params={
            "name": "lead.update_qualification",
            "arguments": {
                "lead_id": "lead_1",
                "fields": {"country": "IT"},
                "idempotency_key": "k1",
            },
        },
    )
    assert allowed.status_code == 200
    assert allowed.json()["result"]["structuredContent"]["id"] == "lead_1"
    assert denied.status_code == 200
    assert denied.json()["error"]["code"] == -32001


def test_2_agent_a_cannot_use_agent_b_only_tool(mcp_env) -> None:
    client, _ = mcp_env
    token = _mint(
        agent_run_id="run_intake_1",
        agent_key="intake",
        allowed_tools=["document.list_gaps", "lead.get"],
        allowed_scopes=["documents:read", "leads:read"],
    )
    response = _call(
        client,
        token=token,
        method="tools/call",
        params={"name": "document.list_gaps", "arguments": {"student_id": "student_x"}},
    )
    assert response.status_code == 200
    assert response.json()["error"]["code"] == -32001


def test_3_identity_fields_in_arguments_are_rejected(mcp_env) -> None:
    client, _ = mcp_env
    token = _mint()
    response = _call(
        client,
        token=token,
        method="tools/call",
        params={
            "name": "lead.get",
            "arguments": {
                "lead_id": "lead_1",
                "agent_run_id": "forged_run",
                "agent_key": "document",
            },
        },
    )
    assert response.status_code == 200
    assert response.json()["error"]["code"] == -32602


def test_4_cross_case_resource_access_denied(mcp_env) -> None:
    client, _ = mcp_env
    token = _mint()
    response = _call(
        client,
        token=token,
        method="tools/call",
        params={"name": "lead.get", "arguments": {"lead_id": "lead_other"}},
    )
    assert response.status_code == 200
    assert response.json()["error"]["code"] == -32001


def test_5_expired_capability_rejected(mcp_env) -> None:
    client, _ = mcp_env
    token = _mint(expires_delta=timedelta(minutes=-1))
    response = _call(client, token=token, method="tools/list")
    assert response.status_code == 401


def test_6_terminal_agent_run_loses_access(mcp_env) -> None:
    client, factory = mcp_env

    async def cancel_run():
        async with factory() as db:
            async with db.begin():
                await db.execute(
                    update(agent_run_table)
                    .where(agent_run_table.c.id == "run_intake_1")
                    .values(status="CANCELLED", completedAt=SEED_NOW)
                )

    asyncio.run(cancel_run())
    token = _mint()
    response = _call(client, token=token, method="tools/list")
    assert response.status_code == 401


def test_7_disabled_agent_loses_access(mcp_env) -> None:
    client, factory = mcp_env

    async def disable_agent():
        async with factory() as db:
            async with db.begin():
                await db.execute(
                    update(agent_definition_table)
                    .where(agent_definition_table.c.key == "intake")
                    .values(enabled=False)
                )

    asyncio.run(disable_agent())
    token = _mint()
    response = _call(client, token=token, method="tools/list")
    assert response.status_code == 401


def test_8_forged_and_wrong_iss_aud_signature_rejected(mcp_env) -> None:
    client, _ = mcp_env
    forged = _mint(secret="wrong-secret-that-is-longer-than-thirty-two-bytes")
    wrong_iss = _mint(iss="evil-issuer")
    wrong_aud = _mint(aud="evil-audience")
    for token in (forged, wrong_iss, wrong_aud):
        response = _call(client, token=token, method="initialize")
        assert response.status_code == 401


def test_9_tools_list_filters_to_allow_list(mcp_env) -> None:
    client, _ = mcp_env
    token = _mint(
        allowed_tools=["lead.get", "document.list_gaps"],
        allowed_scopes=["leads:read", "documents:read"],
    )
    response = _call(client, token=token, method="tools/list")
    assert response.status_code == 200
    names = {tool["name"] for tool in response.json()["result"]["tools"]}
    assert names == {"lead.get"}
    bootstrap = _call(client, token=BOOTSTRAP_KEY, method="tools/list")
    assert bootstrap.status_code == 200
    assert bootstrap.json()["result"]["tools"] == []
    bootstrap_call = _call(
        client,
        token=BOOTSTRAP_KEY,
        method="tools/call",
        params={"name": "lead.get", "arguments": {"lead_id": "lead_1"}},
    )
    assert bootstrap_call.status_code == 200
    assert bootstrap_call.json()["error"]["code"] == -32001


def test_10_responses_do_not_leak_raw_capability_or_secrets(mcp_env) -> None:
    client, _ = mcp_env
    token = _mint()
    responses = [
        _call(client, token=token, method="tools/list"),
        _call(
            client,
            token=token,
            method="tools/call",
            params={
                "name": "lead.get",
                "arguments": {"lead_id": "lead_other"},
            },
        ),
        _call(client, token="forged.not.a.jwt", method="tools/list"),
        _call(client, token=BOOTSTRAP_KEY, method="initialize"),
    ]
    for response in responses:
        assert token not in response.text
        assert CAPABILITY_SECRET not in response.text
        assert "capability-secret" not in response.text


def test_11_wrong_resource_binding_claims_rejected(mcp_env) -> None:
    client, _ = mcp_env
    for token in (
        _mint(student_id="student_forged"),
        _mint(lead_id="lead_other"),
        _mint(conversation_id="conversation_other"),
        _mint(lead_id=None),
        _mint(conversation_id=None),
    ):
        response = _call(client, token=token, method="tools/list")
        assert response.status_code == 401


def test_12_old_agent_version_rejected(mcp_env) -> None:
    client, _ = mcp_env
    token = _mint(agent_version="0.9.0")
    response = _call(client, token=token, method="tools/list")
    assert response.status_code == 401


def test_13_terminal_and_disabled_still_rejected(mcp_env) -> None:
    """Regression: terminal runs and disabled agents still get 401 after binding checks."""
    client, factory = mcp_env
    token = _mint()

    async def cancel_run():
        async with factory() as db:
            async with db.begin():
                await db.execute(
                    update(agent_run_table)
                    .where(agent_run_table.c.id == "run_intake_1")
                    .values(status="FAILED", completedAt=SEED_NOW)
                )

    asyncio.run(cancel_run())
    assert _call(client, token=token, method="tools/list").status_code == 401

    async def reenable_run_disable_agent():
        async with factory() as db:
            async with db.begin():
                await db.execute(
                    update(agent_run_table)
                    .where(agent_run_table.c.id == "run_intake_1")
                    .values(status="RUNNING", completedAt=None)
                )
                await db.execute(
                    update(agent_definition_table)
                    .where(agent_definition_table.c.key == "intake")
                    .values(enabled=False)
                )

    asyncio.run(reenable_run_disable_agent())
    assert _call(client, token=token, method="tools/list").status_code == 401


def test_14_resource_outside_run_context_denied(mcp_env) -> None:
    client, _ = mcp_env
    token = _mint()
    response = _call(
        client,
        token=token,
        method="tools/call",
        params={"name": "lead.get", "arguments": {"lead_id": "lead_other"}},
    )
    assert response.status_code == 200
    assert response.json()["error"]["code"] == -32001


def test_15_bootstrap_gets_zero_tools(mcp_env) -> None:
    client, _ = mcp_env
    listed = _call(client, token=BOOTSTRAP_KEY, method="tools/list")
    assert listed.status_code == 200
    assert listed.json()["result"]["tools"] == []
    called = _call(
        client,
        token=BOOTSTRAP_KEY,
        method="tools/call",
        params={"name": "lead.get", "arguments": {"lead_id": "lead_1"}},
    )
    assert called.status_code == 200
    assert called.json()["error"]["code"] == -32001


def test_mint_helper_matches_public_api() -> None:
    token = mint_mcp_capability(
        secret=CAPABILITY_SECRET,
        agent_run_id="run_1",
        agent_key="intake",
        agent_version="1.0.0",
        allowed_tools=["lead.get"],
        allowed_scopes=["leads:read"],
        timeout_seconds=30,
        lead_id="lead_1",
        now=datetime.now(UTC),
    )
    assert isinstance(token, str)
    assert token.count(".") == 2


async def test_hermes_create_run_puts_capability_only_in_mcp_headers() -> None:
    import json as json_lib

    import httpx

    seen: dict[str, Any] = {}

    def handler(request: httpx.Request) -> httpx.Response:
        payload = request.read()
        seen["json"] = json_lib.loads(payload)
        return httpx.Response(
            202,
            json={"id": "run_h1", "status": "queued", "session_id": None},
        )

    from app.core.config import Settings

    client = HermesClient(
        Settings(
            HERMES_API_URL="https://hermes.internal",
            HERMES_API_KEY="test-hermes-key",
        ),
        transport=httpx.MockTransport(handler),
    )
    token = "capability.jwt.token.should.not.leak"
    await client.create_run(
        prompt="do work",
        idempotency_key="k1",
        session_id=None,
        metadata={"agent_key": "intake"},
        mcp_authorization=token,
    )
    assert seen["json"]["mcp"]["headers"]["Authorization"] == f"Bearer {token}"
    assert token not in json_lib.dumps(seen["json"].get("metadata", {}))
    assert token not in seen["json"]["input"]
    serialized = json_lib.dumps(seen["json"])
    # Token appears only inside mcp.headers.Authorization.
    assert serialized.count(token) == 1


async def test_invoke_tool_uses_principal_not_argument_identity() -> None:
    principal = _principal(
        agent_run_id="verified_run",
        agent_key="intake",
        allowed_tools=frozenset({"lead.get"}),
        allowed_scopes=frozenset({"leads:read"}),
        lead_id="lead_1",
    )
    with pytest.raises(ValueError, match="Unknown arguments"):
        await invoke_tool(  # type: ignore[arg-type]
            None,
            name="lead.get",
            arguments={"lead_id": "lead_1", "agent_run_id": "spoof"},
            principal=principal,
        )
