from pydantic import BaseModel


class StudentSummary(BaseModel):
    id: str
    first_name: str
    last_name: str
    email: str
    status: str
    journey_stage: str
    risk_level: str
    intake: str
    target_field: str | None
    preferred_language: str | None
    curator_id: str | None
    curator_name: str | None
    study_level: str
    country: str | None
    next_action_json: str | None
    application_count: int
    document_count: int
    approved_document_count: int
