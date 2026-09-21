from typing import Literal

from pydantic import BaseModel, Field

ApplicantCategory = Literal[
    "EU_CITIZEN",
    "EU_EQUIVALENT",
    "NON_EU_RESIDENT_ITALY",
    "NON_EU_RESIDENT_ABROAD",
    "UNKNOWN",
]
EligibilityStatus = Literal["ELIGIBLE", "LIKELY_ELIGIBLE", "NEEDS_REVIEW", "NOT_ELIGIBLE"]
RequirementStatus = Literal["MET", "NOT_MET", "UNKNOWN"]


class MatchingProfileInput(BaseModel):
    applicant_category: ApplicantCategory = "UNKNOWN"
    desired_degree_level: str = "UNKNOWN"
    english_level: str = "UNKNOWN"
    italian_level: str = "UNKNOWN"
    sat: float | str | None = "UNKNOWN"
    tolc: dict[str, float | str] = Field(default_factory=dict)
    preferred_teaching_languages: list[str] = Field(default_factory=list)
    excluded_cities: list[str] = Field(default_factory=list)
    excluded_regions: list[str] = Field(default_factory=list)


class RequirementInput(BaseModel):
    type: str
    required: bool
    operator: str | None = None
    value: dict[str, object] = Field(default_factory=dict)
    description: str | None = None
    source_url: str | None = None


class CycleInput(BaseModel):
    application_deadline: str | None = None
    applicant_category: str | None = None


class EligibilityRequest(BaseModel):
    profile: MatchingProfileInput
    program_degree_level: str
    teaching_languages: list[str] = Field(default_factory=list)
    campus_city: str | None = None
    region: str | None = None
    requirements: list[RequirementInput] = Field(default_factory=list)
    cycles: list[CycleInput] = Field(default_factory=list)
    data_confidence: Literal["HIGH", "MEDIUM", "LOW"] = "LOW"
    using_previous_year: bool = False


class RequirementEvaluation(BaseModel):
    type: str
    description: str
    status: RequirementStatus
    required: bool
    hard_exclusion: bool = False
    source_url: str | None = None


class EligibilityResponse(BaseModel):
    status: EligibilityStatus
    evaluations: list[RequirementEvaluation]
    risks: list[str]
