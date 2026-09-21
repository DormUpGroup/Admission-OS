from datetime import datetime

from pydantic import BaseModel, Field


class DeadlineSummary(BaseModel):
    id: str
    title: str
    date: datetime
    type: str
    student_id: str
    application_id: str | None
    is_hard_deadline: bool
    is_internal: bool
    risk_weight: int
    student_name: str | None = None


class CreateDeadlineRequest(BaseModel):
    title: str = Field(min_length=1, max_length=200)
    date: datetime
    student_id: str
    application_id: str | None = None
    requirement_id: str | None = None
    task_id: str | None = None
    type: str = "OTHER"
    is_hard_deadline: bool = False
    is_internal: bool = False
    risk_weight: int = Field(default=1, ge=0, le=10)
