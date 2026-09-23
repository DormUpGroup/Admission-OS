from typing import Any, Literal

from pydantic import BaseModel, Field


class ApprovalDecisionRequest(BaseModel):
    decision: Literal["APPROVED", "REJECTED"]
    note: str | None = Field(default=None, max_length=2000)


class AutomationToggleRequest(BaseModel):
    enabled: bool
    reason: str | None = Field(default=None, max_length=500)


class ConversationPauseRequest(BaseModel):
    paused: bool
    reason: str | None = Field(default=None, max_length=500)


class AgentDefinitionUpdateRequest(BaseModel):
    enabled: bool | None = None
    autonomy_level: str | None = Field(default=None, max_length=64)
    max_iterations: int | None = Field(default=None, ge=1, le=50)
    timeout_seconds: int | None = Field(default=None, ge=5, le=3600)


class AutomationOverview(BaseModel):
    automation_enabled: bool
    leads_by_status: dict[str, int]
    pending_approvals: int
    active_runs: int
    pending_outbox: int
    dead_outbox: int
    agents: list[dict[str, Any]]
