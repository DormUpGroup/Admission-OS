from datetime import datetime

from pydantic import BaseModel


class NotificationSummary(BaseModel):
    id: str
    type: str
    title: str
    body: str
    metadata_json: str | None
    read_at: datetime | None
    created_at: datetime
