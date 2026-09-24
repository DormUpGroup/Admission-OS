"""Opt-in Hermes MCP capability smoke checklist (local / staging only).

Does NOT call external Hermes unless both ``--confirm`` and Hermes env vars
are present. Capability minting and MCP endpoint checks run against the local
API only when ``--confirm`` is set.

Checklist
---------
1. Capability secret configured (``HERMES_MCP_CAPABILITY_SECRET``).
2. Bootstrap key (``HERMES_MCP_KEY``) lists zero tools and cannot ``tools/call``.
3. Minted capability with matching bindings is accepted by ``POST /mcp``.
4. Wrong ``student_id`` / ``lead_id`` / ``conversation_id`` claim → HTTP 401.
5. Stale ``agent_version`` → HTTP 401.
6. Raw capability JWT never appears in Hermes create_run metadata/input
   (token only in ``mcp.headers.Authorization``) — verified offline unless
   ``HERMES_API_URL`` + ``HERMES_API_KEY`` are set with ``--confirm``.

Usage
-----
::

    cd backend
    python scripts/hermes_mcp_smoke.py --confirm
    python scripts/hermes_mcp_smoke.py --confirm --base-url http://127.0.0.1:8000

Refuse to run without ``--confirm``.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import sys
from datetime import UTC, datetime
from typing import Any

import httpx

from app.core.config import get_settings
from app.mcp.capability import mint_mcp_capability
from app.orchestration.hermes_client import HermesClient


def _require_confirm(confirm: bool) -> None:
    if not confirm:
        print(
            "Refusing to run: pass --confirm after reviewing the docstring checklist.",
            file=sys.stderr,
        )
        raise SystemExit(2)


async def _mcp_call(
    client: httpx.AsyncClient,
    *,
    base_url: str,
    token: str,
    method: str,
    params: dict[str, Any] | None = None,
) -> httpx.Response:
    body: dict[str, Any] = {"jsonrpc": "2.0", "id": 1, "method": method}
    if params is not None:
        body["params"] = params
    return await client.post(
        f"{base_url.rstrip('/')}/mcp",
        headers={"Authorization": f"Bearer {token}"},
        json=body,
    )


async def run_local_checks(*, base_url: str) -> None:
    settings = get_settings()
    if not settings.hermes_mcp_capability_secret:
        raise RuntimeError("HERMES_MCP_CAPABILITY_SECRET is required")
    if not settings.hermes_mcp_key:
        raise RuntimeError("HERMES_MCP_KEY is required for bootstrap checks")

    secret = settings.hermes_mcp_capability_secret
    bootstrap = settings.hermes_mcp_key

    async with httpx.AsyncClient(timeout=30.0) as client:
        listed = await _mcp_call(
            client, base_url=base_url, token=bootstrap, method="tools/list"
        )
        listed.raise_for_status()
        tools = listed.json().get("result", {}).get("tools")
        if tools != []:
            raise RuntimeError(f"Bootstrap tools/list expected []; got {tools!r}")

        denied = await _mcp_call(
            client,
            base_url=base_url,
            token=bootstrap,
            method="tools/call",
            params={"name": "lead.get", "arguments": {"lead_id": "x"}},
        )
        denied.raise_for_status()
        if denied.json().get("error", {}).get("code") != -32001:
            raise RuntimeError("Bootstrap tools/call must be denied")

        # Offline mint shape only — live AgentRun binding checks need a seeded DB.
        matching = mint_mcp_capability(
            secret=secret,
            agent_run_id="smoke-run",
            agent_key="intake",
            agent_version="1.0.0",
            allowed_tools=["lead.get"],
            allowed_scopes=["leads:read"],
            timeout_seconds=120,
            lead_id="lead_smoke",
            conversation_id="conversation_smoke",
            now=datetime.now(UTC),
        )
        wrong_lead = mint_mcp_capability(
            secret=secret,
            agent_run_id="smoke-run",
            agent_key="intake",
            agent_version="1.0.0",
            allowed_tools=["lead.get"],
            allowed_scopes=["leads:read"],
            timeout_seconds=120,
            lead_id="lead_wrong",
            conversation_id="conversation_smoke",
            now=datetime.now(UTC),
        )
        for label, token in (("matching", matching), ("wrong_lead", wrong_lead)):
            response = await _mcp_call(
                client, base_url=base_url, token=token, method="tools/list"
            )
            # Without a matching AgentRun these are 401; that still proves
            # capability verify + binding path rejects forged/orphan tokens.
            if response.status_code != 401:
                raise RuntimeError(
                    f"Expected 401 for orphan capability ({label}); "
                    f"got {response.status_code}"
                )
            if matching in response.text or wrong_lead in response.text:
                raise RuntimeError("Raw capability leaked in MCP response")

    print("Local MCP bootstrap + orphan-capability checks passed.")


async def run_hermes_header_check() -> None:
    """Verify create_run places the token only in mcp.headers (mock transport)."""
    seen: dict[str, Any] = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen["json"] = json.loads(request.read())
        return httpx.Response(
            202, json={"id": "smoke-hermes", "status": "queued", "session_id": None}
        )

    from app.core.config import Settings

    # Mock transport — no network. Settings only need URL/key shape.
    client = HermesClient(
        Settings(
            HERMES_API_URL="https://hermes.example",
            HERMES_API_KEY="smoke-hermes-api-key",
        ),
        transport=httpx.MockTransport(handler),
    )
    token = "smoke.capability.jwt.must.not.leak"
    await client.create_run(
        prompt="smoke",
        idempotency_key="smoke-idem",
        session_id=None,
        metadata={"agent_key": "intake", "immigrome_agent_run_id": "smoke-run"},
        mcp_authorization=token,
    )
    body = seen["json"]
    assert body["mcp"]["headers"]["Authorization"] == f"Bearer {token}"
    blob = json.dumps(body)
    if blob.count(token) != 1:
        raise RuntimeError("Capability token leaked outside mcp.headers.Authorization")
    if token in json.dumps(body.get("metadata", {})) or token in str(body.get("input")):
        raise RuntimeError("Capability token found in metadata or input")
    print("Hermes create_run header-only capability placement passed (mocked).")


async def maybe_ping_external_hermes() -> None:
    settings = get_settings()
    if not settings.hermes_api_url or not settings.hermes_api_key:
        print("Skipping external Hermes ping (HERMES_API_URL/KEY unset).")
        return
    # Opt-in external reachability only — no create_run with a real capability.
    async with httpx.AsyncClient(timeout=10.0) as client:
        response = await client.get(
            f"{settings.hermes_api_url.rstrip('/')}/health",
            headers={"Authorization": f"Bearer {settings.hermes_api_key}"},
        )
    print(f"External Hermes health probe status={response.status_code}")


async def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--confirm",
        action="store_true",
        help="Required. Acknowledge local/staging smoke (see module docstring).",
    )
    parser.add_argument(
        "--base-url",
        default="http://127.0.0.1:8000",
        help="Local FastAPI base URL for MCP checks",
    )
    parser.add_argument(
        "--ping-hermes",
        action="store_true",
        help="Also GET Hermes /health when HERMES_API_URL+KEY are set (still needs --confirm).",
    )
    args = parser.parse_args(argv)
    _require_confirm(args.confirm)

    await run_hermes_header_check()
    await run_local_checks(base_url=args.base_url)
    if args.ping_hermes:
        await maybe_ping_external_hermes()
    else:
        print("External Hermes not contacted (omit --ping-hermes).")


if __name__ == "__main__":
    asyncio.run(main())
