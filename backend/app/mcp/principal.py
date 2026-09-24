from dataclasses import dataclass


@dataclass(frozen=True)
class McpPrincipal:
    """Immutable verified MCP identity for one AgentRun capability."""

    agent_run_id: str
    agent_key: str
    agent_version: str
    allowed_tools: frozenset[str]
    allowed_scopes: frozenset[str]
    student_id: str | None = None
    lead_id: str | None = None
    conversation_id: str | None = None
    correlation_id: str | None = None
    jti: str | None = None

    @property
    def principal_id(self) -> str:
        return f"agent:{self.agent_run_id}"
