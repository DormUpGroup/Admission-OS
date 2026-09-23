from datetime import datetime

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


class CreateStudentRequest(BaseModel):
    first_name: str
    last_name: str
    email: str
    phone: str | None = None
    country: str | None = None
    nationality: str | None = None
    study_level: str = "BACHELOR"
    intake: str
    target_field: str | None = None
    preferred_language: str | None = None
    curator_id: str | None = None


class UpdateStudentRequest(BaseModel):
    first_name: str | None = None
    last_name: str | None = None
    phone: str | None = None
    country: str | None = None
    nationality: str | None = None
    study_level: str | None = None
    intake: str | None = None
    target_field: str | None = None
    preferred_language: str | None = None
    preferred_cities: str | None = None
    questionnaire_at: datetime | None = None
    mark_questionnaire_at: bool = False
    questionnaire_personal_json: str | None = None
    questionnaire_programs_json: str | None = None
    questionnaire_programs_at: datetime | None = None
    mark_questionnaire_programs_at: bool = False
    status: str | None = None
    journey_stage: str | None = None
    curator_id: str | None = None
    accompaniment_status: str | None = None
