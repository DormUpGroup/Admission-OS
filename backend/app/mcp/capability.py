from __future__ import annotations

from datetime import UTC, datetime, timedelta
from typing import Any
from uuid import uuid4

import jwt

CAPABILITY_ISSUER = "immigrome-mcp"
CAPABILITY_AUDIENCE = "immigrome-hermes-mcp"
_MIN_TTL_SECONDS = 15 * 60
_MAX_TTL_SECONDS = 60 * 60


class CapabilityError(Exception):
    """Capability mint/verify failure without leaking token material."""


def capability_ttl_seconds(timeout_seconds: int) -> int:
    return min(max(int(timeout_seconds), _MIN_TTL_SECONDS), _MAX_TTL_SECONDS)


def mint_mcp_capability(
    *,
    secret: str,
    agent_run_id: str,
    agent_key: str,
    agent_version: str,
    allowed_tools: list[str] | tuple[str, ...] | frozenset[str],
    allowed_scopes: list[str] | tuple[str, ...] | frozenset[str],
    timeout_seconds: int,
    student_id: str | None = None,
    lead_id: str | None = None,
    conversation_id: str | None = None,
    correlation_id: str | None = None,
    now: datetime | None = None,
) -> str:
    if not secret:
        raise CapabilityError("MCP capability secret is not configured")
    issued_at = now or datetime.now(UTC)
    expires = issued_at + timedelta(seconds=capability_ttl_seconds(timeout_seconds))
    claims: dict[str, Any] = {
        "iss": CAPABILITY_ISSUER,
        "aud": CAPABILITY_AUDIENCE,
        "iat": issued_at,
        "exp": expires,
        "jti": uuid4().hex,
        "agent_run_id": agent_run_id,
        "agent_key": agent_key,
        "agent_version": agent_version,
        "allowed_tools": sorted(allowed_tools),
        "allowed_scopes": sorted(allowed_scopes),
    }
    if student_id:
        claims["student_id"] = student_id
    if lead_id:
        claims["lead_id"] = lead_id
    if conversation_id:
        claims["conversation_id"] = conversation_id
    if correlation_id:
        claims["correlation_id"] = correlation_id
    return jwt.encode(claims, secret, algorithm="HS256")


def verify_mcp_capability(token: str, *, secret: str) -> dict[str, Any]:
    if not secret:
        raise CapabilityError("MCP capability secret is not configured")
    if not token or not isinstance(token, str):
        raise CapabilityError("Invalid MCP capability")
    try:
        claims = jwt.decode(
            token,
            secret,
            algorithms=["HS256"],
            audience=CAPABILITY_AUDIENCE,
            issuer=CAPABILITY_ISSUER,
            options={
                "require": [
                    "iss",
                    "aud",
                    "iat",
                    "exp",
                    "jti",
                    "agent_run_id",
                    "agent_key",
                    "agent_version",
                    "allowed_tools",
                    "allowed_scopes",
                ]
            },
        )
    except jwt.PyJWTError as error:
        raise CapabilityError("Invalid MCP capability") from error

    tools = claims.get("allowed_tools")
    scopes = claims.get("allowed_scopes")
    if not isinstance(tools, list) or not all(isinstance(item, str) for item in tools):
        raise CapabilityError("Invalid MCP capability")
    if not isinstance(scopes, list) or not all(isinstance(item, str) for item in scopes):
        raise CapabilityError("Invalid MCP capability")
    for key in ("agent_run_id", "agent_key", "agent_version", "jti"):
        value = claims.get(key)
        if not isinstance(value, str) or not value.strip():
            raise CapabilityError("Invalid MCP capability")
    return claims
