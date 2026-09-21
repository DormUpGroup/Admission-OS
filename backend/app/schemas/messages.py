from datetime import datetime

from pydantic import BaseModel, Field


class MessageAttachment(BaseModel):
    name: str = Field(min_length=1, max_length=255)
    file_url: str = Field(min_length=1, max_length=2000)
    storage_path: str | None = None
    document_id: str | None = None


class MessageSummary(BaseModel):
    id: str
    student_id: str
    text: str
    from_student: bool
    author: str
    attachments: list[MessageAttachment]
    created_at: datetime


class SendMessageRequest(BaseModel):
    text: str = Field(default="", max_length=2000)
    attachments: list[MessageAttachment] = Field(default_factory=list, max_length=5)
