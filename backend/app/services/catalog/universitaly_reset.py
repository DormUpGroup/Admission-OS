"""Universitaly live-catalog cache wipe — intentional destructive ADMIN command."""

from __future__ import annotations

import re
from typing import Any

from sqlalchemy import delete, func, or_, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.tables import (
    activity_table,
    admission_cycle_table,
    admission_requirement_table,
    application_table,
    program_academic_year_table,
    program_change_event_table,
    program_fact_table,
    program_match_table,
    program_table,
    source_document_section_table,
    source_document_table,
    student_shortlist_item_table,
    tuition_info_table,
    university_table,
)

_LIVE_EXTERNAL_ID = re.compile(r"^\d+$")


def _is_live_external_id(value: str | None) -> bool:
    return bool(value and _LIVE_EXTERNAL_ID.fullmatch(value))


async def reset_universitaly_cache(db: AsyncSession) -> dict[str, Any]:
    programs = (
        await db.execute(
            select(
                program_table.c.id,
                program_table.c.name,
                program_table.c.universitalyExternalId,
                university_table.c.name.label("university_name"),
            ).join(
                university_table,
                university_table.c.id == program_table.c.universityId,
            )
        )
    ).mappings().all()

    live = [row for row in programs if _is_live_external_id(row.universitalyExternalId)]
    if not live:
        search_cache = await db.execute(
            delete(activity_table).where(
                activity_table.c.type == "PROGRAM_MATCH_GENERATED"
            )
        )
        return {
            "liveProgramsDeleted": 0,
            "matchesDeleted": 0,
            "shortlistDeleted": 0,
            "emptyUniversitiesDeleted": 0,
            "searchCacheDeleted": search_cache.rowcount or 0,
            "skippedWithApplications": [],
        }

    live_ids = [row.id for row in live]
    app_counts = {
        row.programId: row.count
        for row in (
            await db.execute(
                select(
                    application_table.c.programId,
                    func.count(application_table.c.id).label("count"),
                )
                .where(application_table.c.programId.in_(live_ids))
                .group_by(application_table.c.programId)
            )
        ).mappings()
    }
    skipped = [row for row in live if (app_counts.get(row.id) or 0) > 0]
    to_delete = [row for row in live if (app_counts.get(row.id) or 0) == 0]
    delete_ids = [row.id for row in to_delete]
    skipped_with_applications = [
        f"{row.university_name} — {row.name}" for row in skipped
    ]

    matches_deleted = 0
    shortlist_deleted = 0
    live_programs_deleted = 0
    empty_universities_deleted = 0

    if delete_ids:
        pay_ids = list(
            (
                await db.execute(
                    select(program_academic_year_table.c.id).where(
                        program_academic_year_table.c.programId.in_(delete_ids)
                    )
                )
            ).scalars()
        )

        if pay_ids:
            shortlist = await db.execute(
                delete(student_shortlist_item_table).where(
                    student_shortlist_item_table.c.programAcademicYearId.in_(
                        pay_ids
                    )
                )
            )
            matches = await db.execute(
                delete(program_match_table).where(
                    program_match_table.c.programAcademicYearId.in_(pay_ids)
                )
            )
            shortlist_deleted = shortlist.rowcount or 0
            matches_deleted = matches.rowcount or 0

            await db.execute(
                update(admission_requirement_table)
                .where(
                    admission_requirement_table.c.programAcademicYearId.in_(
                        pay_ids
                    )
                )
                .values(sourceFactId=None)
            )
            await db.execute(
                delete(admission_requirement_table).where(
                    admission_requirement_table.c.programAcademicYearId.in_(
                        pay_ids
                    )
                )
            )
            await db.execute(
                delete(tuition_info_table).where(
                    tuition_info_table.c.programAcademicYearId.in_(pay_ids)
                )
            )
            await db.execute(
                delete(admission_cycle_table).where(
                    admission_cycle_table.c.programAcademicYearId.in_(pay_ids)
                )
            )

        await db.execute(
            delete(program_change_event_table).where(
                or_(
                    program_change_event_table.c.programId.in_(delete_ids),
                    program_change_event_table.c.programAcademicYearId.in_(
                        pay_ids or ["__none__"]
                    ),
                )
            )
        )
        await db.execute(
            delete(program_fact_table).where(
                program_fact_table.c.programId.in_(delete_ids)
            )
        )

        source_ids = list(
            (
                await db.execute(
                    select(source_document_table.c.id).where(
                        or_(
                            source_document_table.c.programId.in_(delete_ids),
                            source_document_table.c.programAcademicYearId.in_(
                                pay_ids or ["__none__"]
                            ),
                        )
                    )
                )
            ).scalars()
        )
        if source_ids:
            await db.execute(
                delete(source_document_section_table).where(
                    source_document_section_table.c.sourceDocumentId.in_(
                        source_ids
                    )
                )
            )
            await db.execute(
                delete(source_document_table).where(
                    source_document_table.c.id.in_(source_ids)
                )
            )

        if pay_ids:
            await db.execute(
                delete(program_academic_year_table).where(
                    program_academic_year_table.c.id.in_(pay_ids)
                )
            )

        deleted = await db.execute(
            delete(program_table).where(program_table.c.id.in_(delete_ids))
        )
        live_programs_deleted = deleted.rowcount or 0

        empty_uni_ids = list(
            (
                await db.execute(
                    select(university_table.c.id).where(
                        ~university_table.c.id.in_(
                            select(program_table.c.universityId).distinct()
                        )
                    )
                )
            ).scalars()
        )
        if empty_uni_ids:
            empty_source_ids = list(
                (
                    await db.execute(
                        select(source_document_table.c.id).where(
                            source_document_table.c.universityId.in_(
                                empty_uni_ids
                            )
                        )
                    )
                ).scalars()
            )
            if empty_source_ids:
                await db.execute(
                    delete(source_document_section_table).where(
                        source_document_section_table.c.sourceDocumentId.in_(
                            empty_source_ids
                        )
                    )
                )
                await db.execute(
                    delete(source_document_table).where(
                        source_document_table.c.id.in_(empty_source_ids)
                    )
                )
            await db.execute(
                delete(university_table).where(
                    university_table.c.id.in_(empty_uni_ids)
                )
            )
            empty_universities_deleted = len(empty_uni_ids)

    search_cache = await db.execute(
        delete(activity_table).where(
            activity_table.c.type == "PROGRAM_MATCH_GENERATED"
        )
    )

    return {
        "liveProgramsDeleted": live_programs_deleted,
        "matchesDeleted": matches_deleted,
        "shortlistDeleted": shortlist_deleted,
        "emptyUniversitiesDeleted": empty_universities_deleted,
        "searchCacheDeleted": search_cache.rowcount or 0,
        "skippedWithApplications": skipped_with_applications,
    }


async def handle_universitaly_cache_reset(
    db: AsyncSession, event: dict[str, Any]
) -> None:
    """Outbox worker entry for catalog.universitaly_cache.reset.v1."""
    _ = event
    await reset_universitaly_cache(db)
