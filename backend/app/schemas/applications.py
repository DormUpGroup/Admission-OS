from datetime import datetime

from pydantic import BaseModel


class ApplicationProgram(BaseModel):
    id: str
    name: str
    university_name: str


class RequirementSummary(BaseModel):
    id: str
    name: str
    type: str
    status: str
    is_critical: bool
    related_document_id: str | None
    due_date: datetime | None


class ApplicationSummary(BaseModel):
    id: str
    student_id: str
    status: str
    intake: str
    hard_deadline: datetime | None
    target_submission_date: datetime | None
    readiness_percent: int
    risk_level: str
    program: ApplicationProgram
    requirements: list[RequirementSummary]


class CreateApplicationRequest(BaseModel):
    student_id: str
    program_id: str
    program_academic_year_id: str | None = None
    intake: str
    hard_deadline: datetime | None = None
    target_submission_date: datetime | None = None
    application_round: str | None = None


class UpdateApplicationStatusRequest(BaseModel):
    status: str


class SubmitApplicationRequest(BaseModel):
    application_id_external: str | None = None
    submission_confirmation_note: str | None = None
    application_fee_paid: bool = False
    force: bool = False
