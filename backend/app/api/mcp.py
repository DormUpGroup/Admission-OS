import json
import secrets
from typing import Any

from fastapi import APIRouter, Depends, Header, HTTPException, Response, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import Settings, get_settings
from app.db.session import get_db_session
from app.mcp import tools as _tools  # noqa: F401
from app.mcp.registry import invoke_tool, list_tools

router = APIRouter(tags=["mcp"])
PROTOCOL_VERSION = "2025-06-18"


def _error(request_id: Any, code: int, message: str) -> dict[str, Any]:
    return {
        "jsonrpc": "2.0",
        "id": request_id,
        "error": {"code": code, "message": message},
    }


@router.post("/mcp", response_model=None)
async def mcp_endpoint(
    payload: dict[str, Any],
    authorization: str | None = Header(default=None),
    settings: Settings = Depends(get_settings),
    db: AsyncSession = Depends(get_db_session),
) -> Response | dict[str, Any]:
    if not settings.hermes_mcp_key:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Hermes MCP is not configured",
        )
    expected = f"Bearer {settings.hermes_mcp_key}"
    if not authorization or not secrets.compare_digest(authorization, expected):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid MCP credential",
        )
    request_id = payload.get("id")
    method = payload.get("method")
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
            "result": {"tools": [tool.as_mcp_tool() for tool in list_tools()]},
        }
    if method != "tools/call":
        return _error(request_id, -32601, "Method not found")
    params = payload.get("params")
    if not isinstance(params, dict) or not isinstance(params.get("name"), str):
        return _error(request_id, -32602, "Invalid tool call parameters")
    arguments = params.get("arguments") or {}
    if not isinstance(arguments, dict):
        return _error(request_id, -32602, "Tool arguments must be an object")
    scopes = frozenset(
        scope.strip()
        for scope in settings.hermes_mcp_scopes.split(",")
        if scope.strip()
    )
    try:
        async with db.begin():
            result = await invoke_tool(
                db,
                name=params["name"],
                arguments=arguments,
                scopes=scopes,
            )
    except KeyError as error:
        return _error(request_id, -32601, str(error))
    except PermissionError as error:
        return _error(request_id, -32001, str(error))
    except (TypeError, ValueError) as error:
        return _error(request_id, -32602, str(error))
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
