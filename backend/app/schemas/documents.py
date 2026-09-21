from datetime import datetime

from pydantic import BaseModel


class DocumentSummary(BaseModel):
    id: str
    student_id: str
    name: str
    category: str
    status: str
    storage_path: str | None
    uploaded_at: datetime | None
    reviewed_at: datetime | None
    requested_at: datetime | None
    student_feedback: str | None
    file_url: str | None = None


class CreateDocumentRequest(BaseModel):
    student_id: str
    name: str
    category: str = "OTHER"


class NeedsChangesRequest(BaseModel):
    reason: str


class DocumentUploadRequest(BaseModel):
    storage_path: str
    file_url: str
