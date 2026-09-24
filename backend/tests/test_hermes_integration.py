import json

import httpx
from fastapi.testclient import TestClient

from app.core.config import Settings, get_settings
from app.main import app
from app.orchestration.hermes_client import HermesClient


async def test_hermes_client_creates_idempotent_run() -> None:
    seen: dict = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen["authorization"] = request.headers["authorization"]
        seen["idempotency"] = request.headers["idempotency-key"]
        seen["payload"] = json.loads(request.content)
        return httpx.Response(
            202,
            json={
                "id": "run_123",
                "status": "queued",
                "session_id": "session_1",
            },
        )

    settings = Settings(
        HERMES_API_URL="https://hermes.internal",
        HERMES_API_KEY="test-hermes-key",
    )
    run = await HermesClient(
        settings, transport=httpx.MockTransport(handler)
    ).create_run(
        prompt="Handle the inbound lead",
        idempotency_key="agent_run_1",
        session_id=None,
        metadata={"agent_key": "intake"},
    )

    assert run.id == "run_123"
    assert seen["authorization"] == "Bearer test-hermes-key"
    assert seen["idempotency"] == "agent_run_1"
    assert seen["payload"]["metadata"]["agent_key"] == "intake"


def test_mcp_bootstrap_key_cannot_list_or_call_write_tools(monkeypatch) -> None:
    monkeypatch.setenv("HERMES_MCP_KEY", "mcp-test-key")
    get_settings.cache_clear()
    with TestClient(app) as client:
        unauthorized = client.post(
            "/mcp", json={"jsonrpc": "2.0", "id": 1, "method": "tools/list"}
        )
        listed = client.post(
            "/mcp",
            headers={"Authorization": "Bearer mcp-test-key"},
            json={"jsonrpc": "2.0", "id": 1, "method": "tools/list"},
        )
        called = client.post(
            "/mcp",
            headers={"Authorization": "Bearer mcp-test-key"},
            json={
                "jsonrpc": "2.0",
                "id": 2,
                "method": "tools/call",
                "params": {"name": "lead.get", "arguments": {"lead_id": "lead_1"}},
            },
        )
        initialized = client.post(
            "/mcp",
            headers={"Authorization": "Bearer mcp-test-key"},
            json={"jsonrpc": "2.0", "id": 3, "method": "initialize"},
        )
    assert unauthorized.status_code == 401
    assert listed.status_code == 200
    assert listed.json()["result"]["tools"] == []
    assert called.status_code == 200
    assert called.json()["error"]["code"] == -32001
    assert initialized.status_code == 200
    assert initialized.json()["result"]["serverInfo"]["name"] == "immigrome-tools"
    get_settings.cache_clear()


async def test_hermes_client_passes_mcp_authorization_in_body_headers_only() -> None:
    seen: dict = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen["payload"] = json.loads(request.content)
        return httpx.Response(
            202,
            json={"id": "run_123", "status": "queued", "session_id": "session_1"},
        )

    settings = Settings(
        HERMES_API_URL="https://hermes.internal",
        HERMES_API_KEY="test-hermes-key",
    )
    token = "run-scoped-capability-token"
    await HermesClient(settings, transport=httpx.MockTransport(handler)).create_run(
        prompt="Handle the inbound lead",
        idempotency_key="agent_run_1",
        session_id=None,
        metadata={"agent_key": "intake"},
        mcp_authorization=token,
    )
    assert seen["payload"]["mcp"]["headers"]["Authorization"] == f"Bearer {token}"
    assert token not in json.dumps(seen["payload"]["metadata"])
    assert token not in seen["payload"]["input"]
