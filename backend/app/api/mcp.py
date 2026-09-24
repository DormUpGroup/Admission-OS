from __future__ import annotations

import json
import secrets
from typing import Any

from fastapi import APIRouter, Depends, Header, HTTPException, Response, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import Settings, get_settings
from app.db.session import get_db_session
from app.db.tables import agent_definition_table, agent_run_table, conversation_table
from app.mcp import tools as _tools  # noqa: F401
from app.mcp.authz import ResourceAuthorizationError
from app.mcp.capability import CapabilityError, verify_mcp_capability
from app.mcp.principal import McpPrincipal
from app.mcp.registry import get_tool, invoke_tool, list_tools, scopes_for_tools

router = APIRouter(tags=["mcp"])
PROTOCOL_VERSION = "2025-06-18"

_ACTIVE_RUN_STATUSES = frozenset(
    {
        "STARTING",
        "QUEUED",
        "RUNNING",
        "PROCESSING",
        "IN_PROGRESS",
    }
)
_TERMINAL_RUN_STATUSES = frozenset(
    {
        "CANCELLED",
        "FAILED",
        "COMPLETED",
        "SUCCEEDED",
        "DEAD",
        "SKIPPED_DISABLED",
        "ERROR",
        "TIMED_OUT",
    }
)


def _error(request_id: Any, code: int, message: str) -> dict[str, Any]:
    return {
        "jsonrpc": "2.0",
        "id": request_id,
        "error": {"code": code, "message": message},
    }


def _bearer_token(authorization: str | None) -> str | None:
    if not authorization:
        return None
    scheme, _, token = authorization.partition(" ")
    if scheme.lower() != "bearer" or not token:
        return None
    return token.strip()


def _is_bootstrap_key(token: str, settings: Settings) -> bool:
    if not settings.hermes_mcp_key:
        return False
    expected = settings.hermes_mcp_key
    if len(token) != len(expected):
        return False
    return secrets.compare_digest(token, expected)


def _run_is_active(run: Any) -> bool:
    status_value = str(run.status or "").upper()
    if run.completedAt is not None:
        return False
    if status_value in _TERMINAL_RUN_STATUSES:
        return False
    return status_value in _ACTIVE_RUN_STATUSES


def _claim_optional(claims: dict[str, Any], key: str) -> str | None:
    value = claims.get(key)
    return str(value) if isinstance(value, str) and value else None


def _unauthorized() -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Invalid MCP credential",
    )


async def _server_bindings_for_run(
    db: AsyncSession, run: Any
) -> tuple[str | None, str | None, str | None]:
    """Derive conversation/lead/student from AgentRun + Conversation (never from claims)."""
    subject_type = str(run.subjectType or "")
    subject_id = str(run.subjectId) if run.subjectId else None
    conversation_id: str | None = (
        str(run.conversationId) if run.conversationId else None
    )
    if conversation_id is None and subject_type == "Conversation" and subject_id:
        conversation_id = subject_id

    lead_id: str | None = None
    student_id: str | None = None
    if subject_type == "Lead" and subject_id:
        lead_id = subject_id
    elif subject_type == "Student" and subject_id:
        student_id = subject_id

    if conversation_id:
        conversation = (
            await db.execute(
                select(conversation_table).where(
                    conversation_table.c.id == conversation_id
                )
            )
        ).mappings().first()
        if conversation is not None:
            if conversation.leadId:
                lead_id = str(conversation.leadId)
            if conversation.studentId:
                student_id = str(conversation.studentId)

    return conversation_id, lead_id, student_id


def _assert_claim_bindings_match(
    claims: dict[str, Any],
    *,
    conversation_id: str | None,
    lead_id: str | None,
    student_id: str | None,
) -> None:
    """Claims must equal server-derived bindings; absent only when server has none."""
    for key, server_value in (
        ("conversation_id", conversation_id),
        ("lead_id", lead_id),
        ("student_id", student_id),
    ):
        if _claim_optional(claims, key) != server_value:
            raise _unauthorized()


async def _principal_from_capability(
    db: AsyncSession,
    *,
    token: str,
    settings: Settings,
) -> McpPrincipal:
    if not settings.hermes_mcp_capability_secret:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Hermes MCP capability auth is not configured",
        )
    try:
        claims = verify_mcp_capability(
            token, secret=settings.hermes_mcp_capability_secret
        )
    except CapabilityError as error:
        raise _unauthorized() from error

    run_id = str(claims["agent_run_id"])
    run = (
        await db.execute(select(agent_run_table).where(agent_run_table.c.id == run_id))
    ).mappings().first()
    if run is None or not _run_is_active(run):
        raise _unauthorized()
    if run.agentKey != claims["agent_key"]:
        raise _unauthorized()

    definition = (
        await db.execute(
            select(agent_definition_table).where(
                agent_definition_table.c.key == run.agentKey
            )
        )
    ).mappings().first()
    if definition is None or not definition.enabled:
        raise _unauthorized()
    if str(claims["agent_version"]) != str(definition.version):
        raise _unauthorized()

    conversation_id, lead_id, student_id = await _server_bindings_for_run(db, run)
    _assert_claim_bindings_match(
        claims,
        conversation_id=conversation_id,
        lead_id=lead_id,
        student_id=student_id,
    )

    # Allow-list intersection: claims ∩ AgentDefinition ∩ registered tools/scopes.
    claim_tools = frozenset(claims["allowed_tools"])
    claim_scopes = frozenset(claims["allowed_scopes"])
    definition_tools = frozenset(definition.allowedToolsJson or [])
    effective_tools: set[str] = set()
    for name in claim_tools & definition_tools:
        tool = get_tool(name)
        if tool is None:
            continue
        if tool.scope not in claim_scopes:
            continue
        effective_tools.add(name)
    effective_scopes = scopes_for_tools(effective_tools) & claim_scopes

    return McpPrincipal(
        agent_run_id=run_id,
        agent_key=str(run.agentKey),
        agent_version=str(definition.version),
        allowed_tools=frozenset(effective_tools),
        allowed_scopes=frozenset(effective_scopes),
        student_id=student_id,
        lead_id=lead_id,
        conversation_id=conversation_id,
        correlation_id=_claim_optional(claims, "correlation_id"),
        jti=str(claims["jti"]),
    )


@router.post("/mcp", response_model=None)
async def mcp_endpoint(
    payload: dict[str, Any],
    authorization: str | None = Header(default=None),
    settings: Settings = Depends(get_settings),
    db: AsyncSession = Depends(get_db_session),
) -> Response | dict[str, Any]:
    token = _bearer_token(authorization)
    if token is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid MCP credential",
        )

    bootstrap = _is_bootstrap_key(token, settings)
    if not bootstrap and not settings.hermes_mcp_capability_secret:
        if not settings.hermes_mcp_key:
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="Hermes MCP is not configured",
            )
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid MCP credential",
        )
    if not bootstrap and not settings.hermes_mcp_key and not settings.hermes_mcp_capability_secret:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Hermes MCP is not configured",
        )

    request_id = payload.get("id")
    method = payload.get("method")

    if bootstrap:
        if method == "notifications/initialized":
            return Response(status_code=status.HTTP_202_ACCEPTED)
        if method == "initialize":
            return {
                "jsonrpc": "2.0",
                "id": request_id,
                "result": {
                    "protocolVersion": PROTOCOL_VERSION,
                    "capabilities": {"tools": {"listChanged": False}},
                    "serverInfo": {"name": "immigrome-tools", "version": "0.1.0"},
                },
            }
        if method == "tools/list":
            # Bootstrap key must never expose write tools. Return an empty catalog.
            return {
                "jsonrpc": "2.0",
                "id": request_id,
                "result": {"tools": []},
            }
        if method == "tools/call":
            return _error(request_id, -32001, "Bootstrap credential cannot call tools")
        return _error(request_id, -32601, "Method not found")

    try:
        principal = await _principal_from_capability(db, token=token, settings=settings)
    except HTTPException:
        raise
    except Exception as error:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid MCP credential",
        ) from error

    if method == "notifications/initialized":
        return Response(status_code=status.HTTP_202_ACCEPTED)
    if method == "initialize":
        return {
            "jsonrpc": "2.0",
            "id": request_id,
            "result": {
                "protocolVersion": PROTOCOL_VERSION,
                "capabilities": {"tools": {"listChanged": False}},
                "serverInfo": {"name": "immigrome-tools", "version": "0.1.0"},
            },
        }
    if method == "tools/list":
        return {
            "jsonrpc": "2.0",
            "id": request_id,
            "result": {
                "tools": [tool.as_mcp_tool() for tool in list_tools(principal=principal)]
            },
        }
    if method != "tools/call":
        return _error(request_id, -32601, "Method not found")
    params = payload.get("params")
    if not isinstance(params, dict) or not isinstance(params.get("name"), str):
        return _error(request_id, -32602, "Invalid tool call parameters")
    arguments = params.get("arguments") or {}
    if not isinstance(arguments, dict):
        return _error(request_id, -32602, "Tool arguments must be an object")
    try:
        result = await invoke_tool(
            db,
            name=params["name"],
            arguments=arguments,
            principal=principal,
        )
        await db.commit()
    except KeyError:
        await db.rollback()
        return _error(request_id, -32601, "Unknown tool")
    except (PermissionError, ResourceAuthorizationError):
        await db.rollback()
        return _error(request_id, -32001, "Permission denied")
    except (TypeError, ValueError):
        await db.rollback()
        return _error(request_id, -32602, "Invalid tool arguments")
    except Exception:
        await db.rollback()
        raise
    return {
        "jsonrpc": "2.0",
        "id": request_id,
        "result": {
            "content": [
                {
                    "type": "text",
                    "text": json.dumps(result, ensure_ascii=False, default=str),
                }
            ],
            "structuredContent": result,
            "isError": False,
        },
    }
