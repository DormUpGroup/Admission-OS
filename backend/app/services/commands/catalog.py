import hashlib
import json
import re
from datetime import UTC, datetime
from typing import Any
from urllib.parse import urlparse
from uuid import uuid4

from fastapi import HTTPException, status
from sqlalchemy import delete, insert, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.tables import (
    activity_table,
    program_academic_year_table,
    program_fact_table,
    program_match_table,
    program_table,
    source_document_table,
    student_shortlist_item_table,
    student_table,
    university_table,
)
from app.events.records import append_audit, append_outbox
from app.schemas.catalog import (
    CreateProgramRequest,
    CreateUniversityRequest,
    DismissWorkQueueItemRequest,
    ReplaceProgramMatchesRequest,
    ReviewProgramMatchRequest,
    ScoredProgramMatchPayload,
    SetMonitoringSelectedRequest,
    UpsertManualProgramMatchRequest,
    VerifyProgramDossierFactsRequest,
)
from app.services.catalog.readiness import get_programme_selection_readiness
from app.services.commands.base import CommandContext, CommandResult

MONITORING_SELECTED_MAX = 5
_VERIFIABLE_CATEGORIES = frozenset(
    {
        "EU_CITIZEN",
        "EU_EQUIVALENT",
        "NON_EU_RESIDENT_ITALY",
        "NON_EU_RESIDENT_ABROAD",
    }
)
_PROGRAMME_FACT_RESOLVER_VERSION = "manual-verify-v1"
_PRESERVED_MATCH_STATUSES = frozenset(
    {"APPROVED", "REJECTED", "SHORTLISTED", "SELECTED"}
)


def _slugify(name: str, fallback: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")[:80]
    return slug or fallback


def _fact_dimension_key(*, field: str, scope: str, discriminator: str) -> str:
    return f"{field}|{scope}|{discriminator}"


def _registrable_domain(hostname: str) -> str:
    parts = hostname.lower().split(".")
    if len(parts) >= 2:
        return ".".join(parts[-2:])
    return hostname.lower()


async def create_university_command(
    db: AsyncSession,
    *,
    context: CommandContext,
    request: CreateUniversityRequest,
) -> CommandResult:
    now = datetime.now(UTC)
    university_id = uuid4().hex
    slug = _slugify(request.name.strip(), f"university-{university_id[:8]}")
    existing = (
        await db.execute(
            select(university_table.c.id).where(university_table.c.slug == slug)
        )
    ).scalar_one_or_none()
    if existing:
        slug = f"{slug}-{university_id[:6]}"
    await db.execute(
        insert(university_table).values(
            id=university_id,
            name=request.name.strip(),
            slug=slug,
            city=request.city,
            region=request.region,
            website=request.website,
            notes=request.notes,
            country=request.country or "IT",
            createdAt=now,
            updatedAt=now,
        )
    )
    await append_audit(
        db,
        actor_type=context.actor_type,
        actor_id=context.actor_id,
        user_id=context.actor_id,
        action="university.create",
        entity_type="University",
        entity_id=university_id,
        correlation_id=context.correlation_id,
        after={"name": request.name.strip(), "slug": slug},
        now=now,
    )
    await append_outbox(
        db,
        aggregate_type="University",
        aggregate_id=university_id,
        event_type="university.created.v1",
        payload={"university_id": university_id},
        idempotency_key=f"university:create:{context.idempotency_key}",
        now=now,
    )
    return CommandResult(
        response={"id": university_id},
        http_status=status.HTTP_201_CREATED,
        entity_type="University",
        entity_id=university_id,
    )


async def create_program_command(
    db: AsyncSession,
    *,
    context: CommandContext,
    request: CreateProgramRequest,
) -> CommandResult:
    university = (
        await db.execute(
            select(university_table.c.id).where(
                university_table.c.id == request.university_id
            )
        )
    ).scalar_one_or_none()
    if university is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="University not found"
        )
    now = datetime.now(UTC)
    program_id = uuid4().hex
    name = request.name.strip()
    slug = _slugify(name, f"program-{program_id[:8]}")
    teaching_languages = (
        json.dumps([request.language]) if request.language else None
    )
    await db.execute(
        insert(program_table).values(
            id=program_id,
            universityId=request.university_id,
            name=name,
            slug=slug,
            titleOfficial=name,
            degreeLevel=request.degree_level or "BACHELOR",
            language=request.language,
            teachingLanguagesJson=teaching_languages,
            field=request.field,
            notes=request.notes,
            active=True,
            createdAt=now,
            updatedAt=now,
        )
    )
    await append_audit(
        db,
        actor_type=context.actor_type,
        actor_id=context.actor_id,
        user_id=context.actor_id,
        action="program.create",
        entity_type="Program",
        entity_id=program_id,
        correlation_id=context.correlation_id,
        after={
            "name": name,
            "universityId": request.university_id,
            "degreeLevel": request.degree_level,
        },
        now=now,
    )
    await append_outbox(
        db,
        aggregate_type="Program",
        aggregate_id=program_id,
        event_type="program.created.v1",
        payload={"program_id": program_id},
        idempotency_key=f"program:create:{context.idempotency_key}",
        now=now,
    )
    return CommandResult(
        response={"id": program_id},
        http_status=status.HTTP_201_CREATED,
        entity_type="Program",
        entity_id=program_id,
    )


async def reset_program_matches_command(
    db: AsyncSession,
    *,
    context: CommandContext,
    student_id: str,
) -> CommandResult:
    student = (
        await db.execute(
            select(student_table.c.id)
            .where(student_table.c.id == student_id)
            .with_for_update()
        )
    ).scalar_one_or_none()
    if student is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Student not found"
        )
    now = datetime.now(UTC)
    matches = await db.execute(
        delete(program_match_table).where(
            program_match_table.c.studentId == student_id
        )
    )
    shortlist = await db.execute(
        delete(student_shortlist_item_table).where(
            student_shortlist_item_table.c.studentId == student_id
        )
    )
    matches_deleted = matches.rowcount or 0
    shortlist_deleted = shortlist.rowcount or 0
    await db.execute(
        insert(activity_table).values(
            id=uuid4().hex,
            type="PROGRAM_MATCHES_RESET",
            studentId=student_id,
            userId=context.actor_id,
            metadata=json.dumps(
                {
                    "matchesDeleted": matches_deleted,
                    "shortlistDeleted": shortlist_deleted,
                }
            ),
            createdAt=now,
        )
    )
    await append_audit(
        db,
        actor_type=context.actor_type,
        actor_id=context.actor_id,
        user_id=context.actor_id,
        action="program_match.reset",
        entity_type="Student",
        entity_id=student_id,
        correlation_id=context.correlation_id,
        after={
            "matchesDeleted": matches_deleted,
            "shortlistDeleted": shortlist_deleted,
        },
        now=now,
    )
    await append_outbox(
        db,
        aggregate_type="Student",
        aggregate_id=student_id,
        event_type="program_match.reset.v1",
        payload={"student_id": student_id},
        idempotency_key=f"program_match:reset:{context.idempotency_key}",
        now=now,
    )
    return CommandResult(
        response={
            "student_id": student_id,
            "matches_deleted": matches_deleted,
            "shortlist_deleted": shortlist_deleted,
        },
        entity_type="Student",
        entity_id=student_id,
    )


async def reset_universitaly_cache_command(
    db: AsyncSession,
    *,
    context: CommandContext,
) -> CommandResult:
    now = datetime.now(UTC)
    event_id = await append_outbox(
        db,
        aggregate_type="Catalog",
        aggregate_id="universitaly-cache",
        event_type="catalog.universitaly_cache.reset.v1",
        payload={
            "requested_by": context.actor_id,
            "idempotency_key": context.idempotency_key,
        },
        idempotency_key=f"catalog:universitaly_cache_reset:{context.idempotency_key}",
        now=now,
    )
    await append_audit(
        db,
        actor_type=context.actor_type,
        actor_id=context.actor_id,
        user_id=context.actor_id,
        action="catalog.universitaly_cache.reset",
        entity_type="Catalog",
        entity_id="universitaly-cache",
        correlation_id=context.correlation_id,
        after={"status": "queued", "outbox_event_id": event_id},
        now=now,
    )
    return CommandResult(
        response={
            "status": "queued",
            "outbox_event_id": event_id,
            "requested_at": now.isoformat(),
        },
        entity_type="Catalog",
        entity_id="universitaly-cache",
    )


async def _add_to_shortlist(
    db: AsyncSession,
    *,
    context: CommandContext,
    student_id: str,
    program_academic_year_id: str,
    match_id: str | None,
    curator_note: str | None,
    now: datetime,
) -> str:
    ready, reason = await get_programme_selection_readiness(
        db, program_academic_year_id
    )
    if not ready:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=reason)

    if match_id:
        await db.execute(
            update(program_match_table)
            .where(program_match_table.c.id == match_id)
            .values(
                curatorStatus="SHORTLISTED",
                reviewedById=context.actor_id,
                reviewedAt=now,
                updatedAt=now,
            )
        )

    existing = (
        await db.execute(
            select(student_shortlist_item_table)
            .where(
                student_shortlist_item_table.c.studentId == student_id,
                student_shortlist_item_table.c.programAcademicYearId
                == program_academic_year_id,
            )
            .with_for_update()
        )
    ).mappings().first()
    if existing:
        item_id = existing.id
        await db.execute(
            update(student_shortlist_item_table)
            .where(student_shortlist_item_table.c.id == item_id)
            .values(
                programMatchId=match_id or existing.programMatchId,
                curatorNote=curator_note
                if curator_note is not None
                else existing.curatorNote,
                visibleToStudent=True,
                updatedAt=now,
            )
        )
    else:
        item_id = uuid4().hex
        await db.execute(
            insert(student_shortlist_item_table).values(
                id=item_id,
                studentId=student_id,
                programAcademicYearId=program_academic_year_id,
                programMatchId=match_id,
                curatorNote=curator_note,
                studentStatus="PENDING",
                visibleToStudent=True,
                createdAt=now,
                updatedAt=now,
            )
        )

    await db.execute(
        insert(activity_table).values(
            id=uuid4().hex,
            type="PROGRAM_SHORTLISTED",
            studentId=student_id,
            userId=context.actor_id,
            metadata=json.dumps(
                {"programAcademicYearId": program_academic_year_id}
            ),
            createdAt=now,
        )
    )
    return item_id


async def review_program_match_command(
    db: AsyncSession,
    *,
    context: CommandContext,
    request: ReviewProgramMatchRequest,
) -> CommandResult:
    match = (
        await db.execute(
            select(program_match_table)
            .where(program_match_table.c.id == request.match_id)
            .with_for_update()
        )
    ).mappings().first()
    if match is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Match not found"
        )
    if match.studentId != request.student_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Match does not belong to student",
        )
    now = datetime.now(UTC)
    if request.status == "SHORTLISTED":
        item_id = await _add_to_shortlist(
            db,
            context=context,
            student_id=request.student_id,
            program_academic_year_id=match.programAcademicYearId,
            match_id=match.id,
            curator_note=request.notes,
            now=now,
        )
        await append_audit(
            db,
            actor_type=context.actor_type,
            actor_id=context.actor_id,
            user_id=context.actor_id,
            action="program_match.shortlist",
            entity_type="ProgramMatch",
            entity_id=match.id,
            correlation_id=context.correlation_id,
            after={"status": "SHORTLISTED", "shortlist_item_id": item_id},
            now=now,
        )
        return CommandResult(
            response={"id": match.id, "status": "SHORTLISTED"},
            entity_type="ProgramMatch",
            entity_id=match.id,
        )

    await db.execute(
        update(program_match_table)
        .where(program_match_table.c.id == match.id)
        .values(
            curatorStatus=request.status,
            curatorNotes=request.notes,
            reviewedById=context.actor_id,
            reviewedAt=now,
            updatedAt=now,
        )
    )
    await db.execute(
        insert(activity_table).values(
            id=uuid4().hex,
            type="PROGRAM_MATCH_REVIEWED",
            studentId=request.student_id,
            userId=context.actor_id,
            metadata=json.dumps(
                {"matchId": match.id, "status": request.status}
            ),
            createdAt=now,
        )
    )
    await append_audit(
        db,
        actor_type=context.actor_type,
        actor_id=context.actor_id,
        user_id=context.actor_id,
        action="program_match.review",
        entity_type="ProgramMatch",
        entity_id=match.id,
        correlation_id=context.correlation_id,
        before={"curatorStatus": match.curatorStatus},
        after={"curatorStatus": request.status},
        now=now,
    )
    await append_outbox(
        db,
        aggregate_type="ProgramMatch",
        aggregate_id=match.id,
        event_type="program_match.reviewed.v1",
        payload={
            "match_id": match.id,
            "student_id": request.student_id,
            "status": request.status,
        },
        idempotency_key=f"program_match:review:{context.idempotency_key}",
        now=now,
    )
    return CommandResult(
        response={"id": match.id, "status": request.status},
        entity_type="ProgramMatch",
        entity_id=match.id,
    )


async def set_monitoring_selected_command(
    db: AsyncSession,
    *,
    context: CommandContext,
    request: SetMonitoringSelectedRequest,
) -> CommandResult:
    match = (
        await db.execute(
            select(program_match_table)
            .where(program_match_table.c.id == request.match_id)
            .with_for_update()
        )
    ).mappings().first()
    if match is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Match not found"
        )
    if match.studentId != request.student_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Match does not belong to student",
        )
    now = datetime.now(UTC)
    if request.selected:
        count = (
            await db.execute(
                select(program_match_table.c.id).where(
                    program_match_table.c.studentId == match.studentId,
                    program_match_table.c.monitoringSelected.is_(True),
                    program_match_table.c.id != match.id,
                )
            )
        ).all()
        if len(count) >= MONITORING_SELECTED_MAX:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"max_{MONITORING_SELECTED_MAX}_selected",
            )
    await db.execute(
        update(program_match_table)
        .where(program_match_table.c.id == match.id)
        .values(
            monitoringSelected=request.selected,
            monitoringSelectedAt=now if request.selected else None,
            updatedAt=now,
        )
    )
    await append_audit(
        db,
        actor_type=context.actor_type,
        actor_id=context.actor_id,
        user_id=context.actor_id,
        action="program_match.monitoring_selected",
        entity_type="ProgramMatch",
        entity_id=match.id,
        correlation_id=context.correlation_id,
        after={"monitoringSelected": request.selected},
        now=now,
    )
    return CommandResult(
        response={"id": match.id, "selected": request.selected},
        entity_type="ProgramMatch",
        entity_id=match.id,
    )


def _match_values(
    *,
    student_id: str,
    payload: ScoredProgramMatchPayload,
    now: datetime,
    match_id: str | None = None,
) -> dict[str, Any]:
    curator_status = payload.curator_status or (
        "NEEDS_REVIEW"
        if payload.eligibility_status == "NEEDS_REVIEW"
        else "AUTO_MATCHED"
    )
    values: dict[str, Any] = {
        "studentId": student_id,
        "programAcademicYearId": payload.program_academic_year_id,
        "eligibilityStatus": payload.eligibility_status,
        "fitScore": payload.fit_score,
        "scoreBreakdownJson": payload.score_breakdown_json,
        "requirementsSummaryJson": payload.requirements_summary_json,
        "reasonsJson": payload.reasons_json,
        "risksJson": payload.risks_json,
        "missingInformationJson": payload.missing_information_json,
        "discoveryMetaJson": payload.discovery_meta_json,
        "dataConfidence": payload.data_confidence,
        "generatedAt": now,
        "matchingEngineVersion": payload.matching_engine_version,
        "curatorStatus": curator_status,
        "monitoringSelected": False,
        "updatedAt": now,
    }
    if match_id:
        values["id"] = match_id
        values["createdAt"] = now
    return values


async def upsert_manual_program_match_command(
    db: AsyncSession,
    *,
    context: CommandContext,
    request: UpsertManualProgramMatchRequest,
) -> CommandResult:
    now = datetime.now(UTC)
    payload = request.match
    existing = (
        await db.execute(
            select(program_match_table)
            .where(
                program_match_table.c.studentId == request.student_id,
                program_match_table.c.programAcademicYearId
                == payload.program_academic_year_id,
            )
            .with_for_update()
        )
    ).mappings().first()
    if existing:
        match_id = existing.id
        await db.execute(
            update(program_match_table)
            .where(program_match_table.c.id == match_id)
            .values(
                eligibilityStatus=payload.eligibility_status,
                fitScore=payload.fit_score,
                scoreBreakdownJson=payload.score_breakdown_json,
                requirementsSummaryJson=payload.requirements_summary_json,
                reasonsJson=payload.reasons_json,
                risksJson=payload.risks_json,
                missingInformationJson=payload.missing_information_json,
                discoveryMetaJson=payload.discovery_meta_json,
                dataConfidence=payload.data_confidence,
                generatedAt=now,
                matchingEngineVersion=payload.matching_engine_version,
                curatorStatus=payload.curator_status or "NEEDS_REVIEW",
                updatedAt=now,
            )
        )
    else:
        match_id = uuid4().hex
        values = _match_values(
            student_id=request.student_id,
            payload=payload,
            now=now,
            match_id=match_id,
        )
        values["curatorStatus"] = payload.curator_status or "NEEDS_REVIEW"
        await db.execute(insert(program_match_table).values(**values))

    shortlist_id = None
    if request.add_to_shortlist:
        shortlist_id = await _add_to_shortlist(
            db,
            context=context,
            student_id=request.student_id,
            program_academic_year_id=payload.program_academic_year_id,
            match_id=match_id,
            curator_note=request.curator_note,
            now=now,
        )

    await append_audit(
        db,
        actor_type=context.actor_type,
        actor_id=context.actor_id,
        user_id=context.actor_id,
        action="program_match.manual_upsert",
        entity_type="ProgramMatch",
        entity_id=match_id,
        correlation_id=context.correlation_id,
        after={
            "programId": request.program_id,
            "shortlist_item_id": shortlist_id,
        },
        now=now,
    )
    await append_outbox(
        db,
        aggregate_type="ProgramMatch",
        aggregate_id=match_id,
        event_type="program_match.manual_upsert.v1",
        payload={
            "match_id": match_id,
            "student_id": request.student_id,
            "program_id": request.program_id,
        },
        idempotency_key=f"program_match:manual:{context.idempotency_key}",
        now=now,
    )
    return CommandResult(
        response={
            "id": match_id,
            "program_academic_year_id": payload.program_academic_year_id,
            "shortlist_item_id": shortlist_id,
        },
        entity_type="ProgramMatch",
        entity_id=match_id,
    )


async def replace_program_matches_command(
    db: AsyncSession,
    *,
    context: CommandContext,
    student_id: str,
    request: ReplaceProgramMatchesRequest,
) -> CommandResult:
    student = (
        await db.execute(
            select(student_table.c.id)
            .where(student_table.c.id == student_id)
            .with_for_update()
        )
    ).scalar_one_or_none()
    if student is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Student not found"
        )
    now = datetime.now(UTC)
    preserved = (
        await db.execute(
            select(program_match_table).where(
                program_match_table.c.studentId == student_id,
                program_match_table.c.curatorStatus.in_(
                    list(_PRESERVED_MATCH_STATUSES)
                ),
            )
        )
    ).mappings().all()
    preserved_by_pay = {
        row.programAcademicYearId: row for row in preserved
    }

    await db.execute(
        delete(program_match_table).where(
            program_match_table.c.studentId == student_id,
            program_match_table.c.curatorStatus.in_(
                ["AUTO_MATCHED", "NEEDS_REVIEW"]
            ),
        )
    )

    written = 0
    for payload in request.matches:
        existing = preserved_by_pay.get(payload.program_academic_year_id)
        if existing:
            await db.execute(
                update(program_match_table)
                .where(program_match_table.c.id == existing.id)
                .values(
                    eligibilityStatus=payload.eligibility_status,
                    fitScore=payload.fit_score,
                    scoreBreakdownJson=payload.score_breakdown_json,
                    requirementsSummaryJson=payload.requirements_summary_json,
                    reasonsJson=payload.reasons_json,
                    risksJson=payload.risks_json,
                    missingInformationJson=payload.missing_information_json,
                    discoveryMetaJson=payload.discovery_meta_json,
                    dataConfidence=payload.data_confidence,
                    generatedAt=now,
                    matchingEngineVersion=payload.matching_engine_version,
                    updatedAt=now,
                )
            )
        else:
            match_id = uuid4().hex
            await db.execute(
                insert(program_match_table).values(
                    **_match_values(
                        student_id=student_id,
                        payload=payload,
                        now=now,
                        match_id=match_id,
                    )
                )
            )
        written += 1

    await db.execute(
        insert(activity_table).values(
            id=uuid4().hex,
            type="PROGRAM_MATCH_GENERATED",
            studentId=student_id,
            userId=context.actor_id,
            metadata=json.dumps(
                {"count": written, **(request.activity_metadata or {})}
            ),
            createdAt=now,
        )
    )
    await append_audit(
        db,
        actor_type=context.actor_type,
        actor_id=context.actor_id,
        user_id=context.actor_id,
        action="program_match.replace",
        entity_type="Student",
        entity_id=student_id,
        correlation_id=context.correlation_id,
        after={"count": written},
        now=now,
    )
    await append_outbox(
        db,
        aggregate_type="Student",
        aggregate_id=student_id,
        event_type="program_match.replaced.v1",
        payload={"student_id": student_id, "count": written},
        idempotency_key=f"program_match:replace:{context.idempotency_key}",
        now=now,
    )
    return CommandResult(
        response={"student_id": student_id, "count": written},
        entity_type="Student",
        entity_id=student_id,
    )


async def dismiss_work_queue_item_command(
    db: AsyncSession,
    *,
    context: CommandContext,
    request: DismissWorkQueueItemRequest,
) -> CommandResult:
    student = (
        await db.execute(
            select(student_table.c.id).where(
                student_table.c.id == request.student_id
            )
        )
    ).scalar_one_or_none()
    if student is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Student not found"
        )
    now = datetime.now(UTC)
    activity_id = uuid4().hex
    await db.execute(
        insert(activity_table).values(
            id=activity_id,
            type="QUEUE_ITEM_DISMISSED",
            studentId=request.student_id,
            userId=context.actor_id,
            metadata=json.dumps({"sourceKey": request.source_key}),
            createdAt=now,
        )
    )
    await append_audit(
        db,
        actor_type=context.actor_type,
        actor_id=context.actor_id,
        user_id=context.actor_id,
        action="work_queue.dismiss",
        entity_type="Activity",
        entity_id=activity_id,
        correlation_id=context.correlation_id,
        after={
            "studentId": request.student_id,
            "sourceKey": request.source_key,
        },
        now=now,
    )
    return CommandResult(
        response={"id": activity_id},
        entity_type="Activity",
        entity_id=activity_id,
    )


async def _write_verified_fact(
    db: AsyncSession,
    *,
    program_id: str,
    program_academic_year_id: str,
    academic_year: str,
    field: str,
    value: Any,
    raw_value: str | None,
    discriminator: str,
    applicant_category: str,
    source_document_id: str,
    source_url: str,
    evidence_quote: str,
    actor_id: str,
    now: datetime,
) -> None:
    dimension_key = _fact_dimension_key(
        field=field, scope=applicant_category, discriminator=discriminator
    )
    existing = (
        await db.execute(
            select(program_fact_table)
            .where(
                program_fact_table.c.programId == program_id,
                program_fact_table.c.programAcademicYearId
                == program_academic_year_id,
                program_fact_table.c.field == field,
                program_fact_table.c.superseded.is_(False),
                program_fact_table.c.applicantCategoryScope
                == applicant_category,
                program_fact_table.c.dimensionKey == dimension_key,
            )
            .with_for_update()
        )
    ).mappings().first()
    if existing and existing.sourceType != "MANUAL_VERIFIED":
        await db.execute(
            update(program_fact_table)
            .where(program_fact_table.c.id == existing.id)
            .values(superseded=True)
        )
        existing = None
    data = {
        "normalizedValueJson": json.dumps(value),
        "rawValue": raw_value,
        "sourceType": "MANUAL_VERIFIED",
        "confidence": "HIGH",
        "extractionMethod": "MANUAL",
        "verificationStatus": "VERIFIED",
        "sourceDocumentId": source_document_id,
        "sourceUrl": source_url,
        "evidenceQuote": evidence_quote,
        "evidenceValidatedAt": now,
        "applicantCategoryScope": applicant_category,
        "freshness": "CURRENT",
        "origin": "MANUAL_VERIFIED",
        "dimensionKey": dimension_key,
        "decisionStatus": "ELIGIBLE",
        "resolverVersion": _PROGRAMME_FACT_RESOLVER_VERSION,
        "verifiedById": actor_id,
        "verifiedAt": now,
        "retrievedAt": now,
        "superseded": False,
    }
    if existing and existing.sourceType == "MANUAL_VERIFIED":
        await db.execute(
            update(program_fact_table)
            .where(program_fact_table.c.id == existing.id)
            .values(**data)
        )
    else:
        await db.execute(
            insert(program_fact_table).values(
                id=uuid4().hex,
                programId=program_id,
                programAcademicYearId=program_academic_year_id,
                field=field,
                academicYear=academic_year,
                **data,
            )
        )


async def verify_program_dossier_facts_command(
    db: AsyncSession,
    *,
    context: CommandContext,
    request: VerifyProgramDossierFactsRequest,
) -> CommandResult:
    applicant_category = request.applicant_category.strip()
    if applicant_category not in _VERIFIABLE_CATEGORIES:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Applicant category is required for manual verification",
        )
    pay = (
        await db.execute(
            select(
                program_academic_year_table.c.id,
                program_academic_year_table.c.programId,
                program_academic_year_table.c.academicYear,
                program_table.c.officialUrl,
                program_table.c.universityId,
                program_table.c.name.label("program_name"),
            )
            .join(
                program_table,
                program_table.c.id == program_academic_year_table.c.programId,
            )
            .where(
                program_academic_year_table.c.id
                == request.program_academic_year_id
            )
        )
    ).mappings().first()
    if pay is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Program academic year not found",
        )

    manual_source_url = request.manual_source_url.strip()
    evidence_quote = request.evidence_quote.strip()
    if not manual_source_url or not evidence_quote:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Official source URL and evidence quote are required",
        )
    try:
        source_host = urlparse(manual_source_url).hostname or ""
        official_host = (
            urlparse(pay.officialUrl).hostname if pay.officialUrl else None
        )
    except ValueError as error:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid source URL",
        ) from error
    if not source_host:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid source URL",
        )
    if official_host and _registrable_domain(source_host) != _registrable_domain(
        official_host
    ):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Manual verification source must be on the official domain",
        )

    now = datetime.now(UTC)
    content_hash = hashlib.sha256(evidence_quote.encode()).hexdigest()
    source_id = uuid4().hex
    await db.execute(
        insert(source_document_table).values(
            id=source_id,
            sourceType="MANUAL_VERIFIED",
            sourceAuthority=pay.program_name,
            url=manual_source_url,
            academicYear=pay.academicYear,
            universityId=pay.universityId,
            programId=pay.programId,
            programAcademicYearId=pay.id,
            contentType="manual-quote",
            retrievedAt=now,
            contentHash=content_hash,
            rawText=evidence_quote,
            parserVersion="v1",
            status="VERIFIED",
            extractionQuality="MANUAL_VERIFIED",
            createdAt=now,
            updatedAt=now,
        )
    )

    deadline_raw = (request.deadline or "").strip()
    tuition_min_raw = (request.tuition_min or "").strip()
    tuition_max_raw = (request.tuition_max or "").strip()
    access_mode = (request.access_mode or "UNKNOWN").strip().upper()
    non_eu_seats_raw = (request.non_eu_seats or "").strip()
    exams_display = (request.exams_display or "").strip()

    async def write(
        field: str,
        value: Any,
        raw_value: str | None = None,
        discriminator: str = "primary",
    ) -> None:
        await _write_verified_fact(
            db,
            program_id=pay.programId,
            program_academic_year_id=pay.id,
            academic_year=pay.academicYear,
            field=field,
            value=value,
            raw_value=raw_value,
            discriminator=discriminator,
            applicant_category=applicant_category,
            source_document_id=source_id,
            source_url=manual_source_url,
            evidence_quote=evidence_quote,
            actor_id=context.actor_id,
            now=now,
        )

    if deadline_raw:
        try:
            deadline = datetime.fromisoformat(f"{deadline_raw}T12:00:00+00:00")
        except ValueError:
            deadline = None
        if deadline is not None:
            await write(
                "APPLICATION_DEADLINE",
                {"date": deadline.isoformat(), "roundName": "Primary"},
                deadline_raw,
                "primary",
            )

    if non_eu_seats_raw:
        try:
            seats = int(non_eu_seats_raw)
        except ValueError:
            seats = None
        if seats is not None:
            await write(
                "SEATS",
                {
                    "places": seats,
                    "category": applicant_category,
                    "originalGroup": "Manual curator verification",
                },
                f"Manual: {seats} places for {applicant_category}",
                applicant_category,
            )

    tuition_min = int(tuition_min_raw) if tuition_min_raw.isdigit() else None
    tuition_max = int(tuition_max_raw) if tuition_max_raw.isdigit() else None
    if tuition_min is not None or tuition_max is not None:
        fixed = (
            tuition_min
            if tuition_min is not None
            and tuition_max is not None
            and tuition_min == tuition_max
            else None
        )
        await write(
            "TUITION",
            {"min": tuition_min, "max": tuition_max, "fixed": fixed},
            None,
            "annual",
        )

    if access_mode in {"OPEN", "CLOSED"}:
        await write("ACCESS_TYPE", {"mode": access_mode}, access_mode, "access")

    if exams_display:
        exam_type = (
            "SAT"
            if re.search(r"SAT", exams_display, re.I)
            else "TOLC"
            if re.search(r"TOLC", exams_display, re.I)
            else "ADMISSION_TEST"
        )
        await write(
            "ADMISSION_EXAMS",
            {"description": exams_display, "type": exam_type},
            exams_display,
            exams_display,
        )

    await append_audit(
        db,
        actor_type=context.actor_type,
        actor_id=context.actor_id,
        user_id=context.actor_id,
        action="program_fact.manual_verify",
        entity_type="ProgramAcademicYear",
        entity_id=pay.id,
        correlation_id=context.correlation_id,
        after={
            "source_document_id": source_id,
            "applicant_category": applicant_category,
        },
        now=now,
    )
    return CommandResult(
        response={
            "program_academic_year_id": pay.id,
            "source_document_id": source_id,
        },
        entity_type="ProgramAcademicYear",
        entity_id=pay.id,
    )
