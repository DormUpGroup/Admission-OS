from dataclasses import dataclass
from typing import Any

import httpx

from app.core.config import Settings, get_settings


@dataclass(frozen=True)
class HermesRun:
    id: str
    status: str
    session_id: str | None
    output: dict[str, Any] | None = None


class HermesClient:
    def __init__(
        self,
        settings: Settings | None = None,
        *,
        transport: httpx.AsyncBaseTransport | None = None,
    ) -> None:
        self.settings = settings or get_settings()
        self.transport = transport

    def _configuration(self) -> tuple[str, str]:
        if not self.settings.hermes_api_url or not self.settings.hermes_api_key:
            raise RuntimeError("Hermes Runs API is not configured")
        return self.settings.hermes_api_url.rstrip("/"), self.settings.hermes_api_key

    async def create_run(
        self,
        *,
        prompt: str,
        idempotency_key: str,
        session_id: str | None,
        metadata: dict[str, Any],
        mcp_authorization: str | None = None,
    ) -> HermesRun:
        base_url, api_key = self._configuration()
        body: dict[str, Any] = {
            "input": prompt,
            "session_id": session_id,
            "metadata": metadata,
        }
        if mcp_authorization:
            # Per-run MCP credential only. Never put the raw token in metadata,
            # prompt, or logs.
            body["mcp"] = {
                "headers": {"Authorization": f"Bearer {mcp_authorization}"},
            }
        async with httpx.AsyncClient(
            timeout=httpx.Timeout(180.0, connect=10.0),
            transport=self.transport,
        ) as client:
            response = await client.post(
                f"{base_url}/v1/runs",
                headers={
                    "Authorization": f"Bearer {api_key}",
                    "Idempotency-Key": idempotency_key,
                    "Content-Type": "application/json",
                },
                json=body,
            )
        response.raise_for_status()
        payload = response.json()
        run_id = payload.get("id")
        if not run_id:
            raise RuntimeError("Hermes did not return a run id")
        return HermesRun(
            id=str(run_id),
            status=str(payload.get("status") or "queued"),
            session_id=(
                str(payload["session_id"]) if payload.get("session_id") else session_id
            ),
            output=payload.get("output") if isinstance(payload.get("output"), dict) else None,
        )

    async def get_run(self, run_id: str) -> HermesRun:
        base_url, api_key = self._configuration()
        async with httpx.AsyncClient(
            timeout=30.0, transport=self.transport
        ) as client:
            response = await client.get(
                f"{base_url}/v1/runs/{run_id}",
                headers={"Authorization": f"Bearer {api_key}"},
            )
        response.raise_for_status()
        payload = response.json()
        return HermesRun(
            id=str(payload.get("id") or run_id),
            status=str(payload.get("status") or "unknown"),
            session_id=(
                str(payload["session_id"]) if payload.get("session_id") else None
            ),
            output=payload.get("output") if isinstance(payload.get("output"), dict) else None,
        )

    async def cancel_run(self, run_id: str) -> None:
        base_url, api_key = self._configuration()
        async with httpx.AsyncClient(
            timeout=30.0, transport=self.transport
        ) as client:
            response = await client.post(
                f"{base_url}/v1/runs/{run_id}/cancel",
                headers={"Authorization": f"Bearer {api_key}"},
            )
        response.raise_for_status()
