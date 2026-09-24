from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field


class UniversitySummary(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    name: str
    slug: str
    city: str | None
    region: str | None
    country: str | None
    public_private: str | None
    website: str | None


class ProgramSummary(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    name: str
    slug: str
    degree_level: str
    field: str | None
    language: str | None
    active: bool
    university: UniversitySummary
    application_count: int


class CreateUniversityRequest(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    city: str | None = None
    region: str | None = None
    website: str | None = None
    notes: str | None = None
    country: str = "IT"


class CreateProgramRequest(BaseModel):
    university_id: str = Field(min_length=1)
    name: str = Field(min_length=1, max_length=200)
    degree_level: str = "BACHELOR"
    language: str | None = None
    field: str | None = None
    notes: str | None = None


class ResetProgramMatchesRequest(BaseModel):
    student_id: str = Field(min_length=1)


class ReviewProgramMatchRequest(BaseModel):
    student_id: str = Field(min_length=1)
    match_id: str = Field(min_length=1)
    status: Literal["APPROVED", "REJECTED", "NEEDS_REVIEW", "SHORTLISTED"]
    notes: str | None = None


class SetMonitoringSelectedRequest(BaseModel):
    student_id: str = Field(min_length=1)
    match_id: str = Field(min_length=1)
    selected: bool


class ScoredProgramMatchPayload(BaseModel):
    program_academic_year_id: str
    eligibility_status: str
    fit_score: int
    score_breakdown_json: str | None = None
    requirements_summary_json: str | None = None
    reasons_json: str | None = None
    risks_json: str | None = None
    missing_information_json: str | None = None
    discovery_meta_json: str | None = None
    data_confidence: str = "LOW"
    matching_engine_version: str
    curator_status: str | None = None


class UpsertManualProgramMatchRequest(BaseModel):
    student_id: str = Field(min_length=1)
    program_id: str = Field(min_length=1)
    match: ScoredProgramMatchPayload
    add_to_shortlist: bool = True
    curator_note: str | None = "Manually added by curator"


class ReplaceProgramMatchesRequest(BaseModel):
    matches: list[ScoredProgramMatchPayload] = Field(default_factory=list)
    activity_metadata: dict[str, Any] = Field(default_factory=dict)


class DismissWorkQueueItemRequest(BaseModel):
    student_id: str = Field(min_length=1)
    source_key: str = Field(min_length=1, max_length=200)


class VerifyProgramDossierFactsRequest(BaseModel):
    student_id: str | None = None
    program_academic_year_id: str = Field(min_length=1)
    applicant_category: str = Field(min_length=1)
    deadline: str | None = None
    tuition_min: str | None = None
    tuition_max: str | None = None
    access_mode: str | None = None
    non_eu_seats: str | None = None
    exams_display: str | None = None
    manual_source_url: str = Field(min_length=1)
    evidence_quote: str = Field(min_length=1)


class UniversitalyCacheResetStatus(BaseModel):
    status: Literal["queued", "completed"]
    outbox_event_id: str | None = None
    result: dict[str, Any] | None = None
    requested_at: datetime | None = None
