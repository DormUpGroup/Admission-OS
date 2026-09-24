from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from app.mcp.principal import McpPrincipal

ToolHandler = Callable[
    [AsyncSession, dict[str, Any], McpPrincipal], Awaitable[dict[str, Any]]
]


@dataclass(frozen=True)
class ToolDefinition:
    name: str
    description: str
    input_schema: dict[str, Any]
    scope: str
    side_effect: str
    handler: ToolHandler

    def as_mcp_tool(self) -> dict[str, Any]:
        return {
            "name": self.name,
            "description": self.description,
            "inputSchema": self.input_schema,
            "annotations": {
                "readOnlyHint": self.side_effect == "READ",
                "destructiveHint": self.side_effect == "IRREVERSIBLE",
                "idempotentHint": True,
            },
        }


_tools: dict[str, ToolDefinition] = {}


def _validate_arguments(arguments: dict[str, Any], schema: dict[str, Any]) -> None:
    required = set(schema.get("required", []))
    missing = required - set(arguments)
    if missing:
        raise ValueError(f"Missing required arguments: {', '.join(sorted(missing))}")
    properties = schema.get("properties", {})
    if schema.get("additionalProperties") is False:
        unknown = set(arguments) - set(properties)
        if unknown:
            raise ValueError(f"Unknown arguments: {', '.join(sorted(unknown))}")
    python_types = {
        "string": str,
        "integer": int,
        "number": (int, float),
        "boolean": bool,
        "object": dict,
        "array": list,
    }
    for name, value in arguments.items():
        expected_name = properties.get(name, {}).get("type")
        if not expected_name or isinstance(expected_name, list):
            continue
        expected = python_types.get(expected_name)
        if expected and (
            not isinstance(value, expected)
            or expected_name in {"integer", "number"} and isinstance(value, bool)
        ):
            raise ValueError(f"{name} must be {expected_name}")


def register_tool(definition: ToolDefinition) -> None:
    if definition.name in _tools:
        raise RuntimeError(f"MCP tool already registered: {definition.name}")
    _tools[definition.name] = definition


def get_tool(name: str) -> ToolDefinition | None:
    return _tools.get(name)


def scopes_for_tools(tool_names: list[str] | tuple[str, ...] | frozenset[str]) -> frozenset[str]:
    scopes: set[str] = set()
    for name in tool_names:
        definition = _tools.get(name)
        if definition is not None:
            scopes.add(definition.scope)
    return frozenset(scopes)


def list_tools(
    *,
    principal: McpPrincipal | None = None,
    allowed_tools: frozenset[str] | None = None,
    allowed_scopes: frozenset[str] | None = None,
) -> list[ToolDefinition]:
    tools = sorted(_tools.values(), key=lambda item: item.name)
    if principal is not None:
        allowed_tools = principal.allowed_tools
        allowed_scopes = principal.allowed_scopes
    if allowed_tools is not None:
        tools = [tool for tool in tools if tool.name in allowed_tools]
    if allowed_scopes is not None:
        tools = [tool for tool in tools if tool.scope in allowed_scopes]
    return tools


async def invoke_tool(
    db: AsyncSession,
    *,
    name: str,
    arguments: dict[str, Any],
    principal: McpPrincipal,
) -> dict[str, Any]:
    definition = _tools.get(name)
    if definition is None:
        raise KeyError(f"Unknown tool: {name}")
    if name not in principal.allowed_tools:
        raise PermissionError(f"Tool not allowed: {name}")
    if definition.scope not in principal.allowed_scopes:
        raise PermissionError(f"Missing scope: {definition.scope}")
    _validate_arguments(arguments, definition.input_schema)
    return await definition.handler(db, arguments, principal)
