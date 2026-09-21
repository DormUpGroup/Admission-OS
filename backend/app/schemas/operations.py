from datetime import datetime

from pydantic import BaseModel, Field


class RequirementState(BaseModel):
    status: str
    is_critical: bool = False


class RecalculatePreviewRequest(BaseModel):
    application_status: str = "PREPARING"
    requirements: list[RequirementState] = Field(default_factory=list)
    hard_deadline: datetime | None = None
    waiting_days_max: int = 0
    has_overdue_urgent: bool = False


class RecalculatePreview(BaseModel):
    readiness_percent: int
    risk_level: str
