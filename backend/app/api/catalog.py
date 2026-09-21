from typing import Annotated

from fastapi import APIRouter, Depends, Query
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import StaffActor
from app.db.session import get_db_session
from app.db.tables import application_table, program_table, university_table
from app.schemas.catalog import ProgramSummary, UniversitySummary

router = APIRouter(tags=["catalog"])
DbSession = Annotated[AsyncSession, Depends(get_db_session)]


@router.get("/universities", response_model=list[UniversitySummary])
async def list_universities(_: StaffActor, db: DbSession) -> list[UniversitySummary]:
    rows = await db.execute(select(university_table).order_by(university_table.c.name))
    return [
        UniversitySummary(
            id=row.id,
            name=row.name,
            slug=row.slug,
            city=row.city,
            region=row.region,
            country=row.country,
            public_private=row.publicPrivate,
            website=row.website,
        )
        for row in rows.mappings()
    ]


@router.get("/programs", response_model=list[ProgramSummary])
async def list_programs(
    _: StaffActor,
    db: DbSession,
    include_inactive: bool = False,
    limit: Annotated[int, Query(ge=1, le=500)] = 500,
) -> list[ProgramSummary]:
    statement = (
        select(
            program_table.c.id.label("program_id"),
            program_table.c.name.label("program_name"),
            program_table.c.slug.label("program_slug"),
            program_table.c.degreeLevel.label("program_degree_level"),
            program_table.c.field.label("program_field"),
            program_table.c.language.label("program_language"),
            program_table.c.active.label("program_active"),
            university_table.c.id.label("university_id"),
            university_table.c.name.label("university_name"),
            university_table.c.slug.label("university_slug"),
            university_table.c.city.label("university_city"),
            university_table.c.region.label("university_region"),
            university_table.c.country.label("university_country"),
            university_table.c.publicPrivate.label("university_public_private"),
            university_table.c.website.label("university_website"),
            func.count(application_table.c.id).label("application_count"),
        )
        .join(university_table, university_table.c.id == program_table.c.universityId)
        .outerjoin(application_table, application_table.c.programId == program_table.c.id)
        .group_by(program_table.c.id, university_table.c.id)
        .order_by(university_table.c.name, program_table.c.name)
        .limit(limit)
    )
    if not include_inactive:
        statement = statement.where(program_table.c.active.is_(True))

    rows = await db.execute(statement)
    return [
        ProgramSummary(
            id=row.program_id,
            name=row.program_name,
            slug=row.program_slug,
            degree_level=row.program_degree_level,
            field=row.program_field,
            language=row.program_language,
            active=row.program_active,
            university=UniversitySummary(
                id=row.university_id,
                name=row.university_name,
                slug=row.university_slug,
                city=row.university_city,
                region=row.university_region,
                country=row.university_country,
                public_private=row.university_public_private,
                website=row.university_website,
            ),
            application_count=row.application_count,
        )
        for row in rows.mappings()
    ]
