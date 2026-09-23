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


def test_mcp_requires_key_and_lists_only_registered_business_tools(monkeypatch) -> None:
    monkeypatch.setenv("HERMES_MCP_KEY", "mcp-test-key")
    get_settings.cache_clear()
    with TestClient(app) as client:
        unauthorized = client.post(
            "/mcp", json={"jsonrpc": "2.0", "id": 1, "method": "tools/list"}
        )
        authorized = client.post(
            "/mcp",
            headers={"Authorization": "Bearer mcp-test-key"},
            json={"jsonrpc": "2.0", "id": 1, "method": "tools/list"},
        )
    assert unauthorized.status_code == 401
    assert authorized.status_code == 200
    names = {tool["name"] for tool in authorized.json()["result"]["tools"]}
    assert "lead.get" in names
    assert "message.request_send" in names
    assert "sql.execute" not in names
    assert "shell.run" not in names
    get_settings.cache_clear()
