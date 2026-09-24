"""Programme shortlist readiness — mirrors Next getProgrammeSelectionReadiness."""

from sqlalchemy import and_, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.tables import program_fact_table

PROGRAMME_SOURCE_RESOLUTION_FIELD = "PROGRAMME_SOURCE_RESOLUTION"
_DECISION_FIELDS = (
    "ACCESS_TYPE",
    "ADMISSION_REGIME",
    "SELECTION",
    "ADMISSION_EXAMS",
    "SEATS",
    "APPLICATION_DEADLINE",
)


async def get_programme_selection_readiness(
    db: AsyncSession, program_academic_year_id: str
) -> tuple[bool, str]:
    source = (
        await db.execute(
            select(program_fact_table.c.id).where(
                program_fact_table.c.programAcademicYearId
                == program_academic_year_id,
                program_fact_table.c.superseded.is_(False),
                program_fact_table.c.decisionStatus == "ELIGIBLE",
                program_fact_table.c.sourceUrl.is_not(None),
                program_fact_table.c.evidenceQuote.is_not(None),
                or_(
                    and_(
                        program_fact_table.c.field
                        == PROGRAMME_SOURCE_RESOLUTION_FIELD,
                        program_fact_table.c.freshness == "CURRENT",
                    ),
                    and_(
                        program_fact_table.c.origin == "MANUAL_VERIFIED",
                        program_fact_table.c.verificationStatus == "VERIFIED",
                    ),
                ),
            )
        )
    ).scalar_one_or_none()
    if source is None:
        return (
            False,
            "Programme source is not resolved. Run source verification or "
            "confirm the programme page manually before shortlisting.",
        )
    decision = (
        await db.execute(
            select(program_fact_table.c.id).where(
                program_fact_table.c.programAcademicYearId
                == program_academic_year_id,
                program_fact_table.c.superseded.is_(False),
                program_fact_table.c.decisionStatus == "ELIGIBLE",
                program_fact_table.c.freshness == "CURRENT",
                program_fact_table.c.sourceUrl.is_not(None),
                program_fact_table.c.evidenceQuote.is_not(None),
                program_fact_table.c.field.in_(_DECISION_FIELDS),
            )
        )
    ).scalar_one_or_none()
    if decision is None:
        return (
            False,
            "Programme has no verified current admission evidence. It may be "
            "monitored, but cannot be shortlisted or used for an application yet.",
        )
    return True, ""
