from pydantic import BaseModel, ConfigDict


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
