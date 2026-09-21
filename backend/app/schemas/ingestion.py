from pydantic import AnyHttpUrl, BaseModel


class SourcePreviewRequest(BaseModel):
    source_url: AnyHttpUrl


class SourcePreview(BaseModel):
    source_url: str
    content_type: str
    text: str
    quality: str
    used_ocr: bool


class SourceJob(BaseModel):
    job_id: str
    source_url: str
    status: str = "queued"
    task_name: str = "immigrome.ingestion.fetch_extract"
