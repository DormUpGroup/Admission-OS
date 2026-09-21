from datetime import datetime

from pydantic import BaseModel


class DashboardOverview(BaseModel):
    active_students: int
    high_risk_applications: int
    documents_to_review: int
    open_tasks: int
    upcoming_deadlines: int
    unread_notifications: int


class PortalOverview(BaseModel):
    student_id: str
    applications: int
    documents_total: int
    documents_needing_upload: int
    documents_awaiting_review: int
    open_tasks: int
    upcoming_deadlines: int
    unread_notifications: int
    next_deadline_at: datetime | None
