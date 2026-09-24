from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import Actor, StaffActor
from app.db.session import get_db_session
from app.db.tables import application_table, program_table, student_table, university_table
from app.schemas.catalog import (
    CreateProgramRequest,
    CreateUniversityRequest,
    DismissWorkQueueItemRequest,
    ProgramSummary,
    ReplaceProgramMatchesRequest,
    ReviewProgramMatchRequest,
    SetMonitoringSelectedRequest,
    UniversitySummary,
    UpsertManualProgramMatchRequest,
    VerifyProgramDossierFactsRequest,
)
from app.services.commands.base import (
    CommandContext,
    execute_command,
    require_idempotency_key,
)
from app.services.commands.catalog import (
    create_program_command,
    create_university_command,
    dismiss_work_queue_item_command,
    replace_program_matches_command,
    reset_program_matches_command,
    reset_universitaly_cache_command,
    review_program_match_command,
    set_monitoring_selected_command,
    upsert_manual_program_match_command,
    verify_program_dossier_facts_command,
)

router = APIRouter(tags=["catalog"])
DbSession = Annotated[AsyncSession, Depends(get_db_session)]


def require_admin(actor: Actor) -> None:
    if actor.role != "ADMIN":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, detail="Admin access required"
        )


async def assert_student_access(
    actor: StaffActor, db: AsyncSession, student_id: str
) -> None:
    row = (
        await db.execute(
            select(student_table.c.curatorId).where(student_table.c.id == student_id)
        )
    ).mappings().first()
    if row is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Student not found"
        )
    if actor.role == "CURATOR" and row.curatorId not in {actor.id, None}:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, detail="Student access denied"
        )


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


@router.post("/universities", status_code=status.HTTP_201_CREATED)
async def create_university(
    actor: StaffActor,
    db: DbSession,
    request: CreateUniversityRequest,
    idempotency_key: Annotated[str, Depends(require_idempotency_key)],
) -> dict[str, str]:
    await db.rollback()
    async with db.begin():
        context = CommandContext(
            principal_id=actor.id,
            operation="university.create",
            idempotency_key=idempotency_key,
            correlation_id=idempotency_key,
            actor_type="USER",
            actor_id=actor.id,
        )
        executed = await execute_command(
            db,
            context=context,
            payload=request.model_dump(mode="json"),
            handler=lambda command: create_university_command(
                db, context=command, request=request
            ),
        )
    return executed.result.response


@router.post("/programs", status_code=status.HTTP_201_CREATED)
async def create_program(
    actor: StaffActor,
    db: DbSession,
    request: CreateProgramRequest,
    idempotency_key: Annotated[str, Depends(require_idempotency_key)],
) -> dict[str, str]:
    await db.rollback()
    async with db.begin():
        context = CommandContext(
            principal_id=actor.id,
            operation="program.create",
            idempotency_key=idempotency_key,
            correlation_id=idempotency_key,
            actor_type="USER",
            actor_id=actor.id,
        )
        executed = await execute_command(
            db,
            context=context,
            payload=request.model_dump(mode="json"),
            handler=lambda command: create_program_command(
                db, context=command, request=request
            ),
        )
    return executed.result.response


@router.post("/students/{student_id}/program-matches/reset")
async def reset_program_matches(
    actor: StaffActor,
    db: DbSession,
    student_id: str,
    idempotency_key: Annotated[str, Depends(require_idempotency_key)],
) -> dict[str, object]:
    await assert_student_access(actor, db, student_id)
    await db.rollback()
    async with db.begin():
        context = CommandContext(
            principal_id=actor.id,
            operation="program_match.reset",
            idempotency_key=idempotency_key,
            correlation_id=idempotency_key,
            actor_type="USER",
            actor_id=actor.id,
        )
        executed = await execute_command(
            db,
            context=context,
            payload={"student_id": student_id},
            handler=lambda command: reset_program_matches_command(
                db, context=command, student_id=student_id
            ),
        )
    return executed.result.response


@router.post("/catalog/universitaly-cache/reset")
async def reset_universitaly_cache(
    actor: StaffActor,
    db: DbSession,
    idempotency_key: Annotated[str, Depends(require_idempotency_key)],
) -> dict[str, object]:
    require_admin(actor)
    await db.rollback()
    async with db.begin():
        context = CommandContext(
            principal_id=actor.id,
            operation="catalog.universitaly_cache.reset",
            idempotency_key=idempotency_key,
            correlation_id=idempotency_key,
            actor_type="USER",
            actor_id=actor.id,
        )
        executed = await execute_command(
            db,
            context=context,
            payload={},
            handler=lambda command: reset_universitaly_cache_command(
                db, context=command
            ),
        )
    return executed.result.response


@router.post("/program-matches/review")
async def review_program_match(
    actor: StaffActor,
    db: DbSession,
    request: ReviewProgramMatchRequest,
    idempotency_key: Annotated[str, Depends(require_idempotency_key)],
) -> dict[str, object]:
    await assert_student_access(actor, db, request.student_id)
    await db.rollback()
    async with db.begin():
        context = CommandContext(
            principal_id=actor.id,
            operation="program_match.review",
            idempotency_key=idempotency_key,
            correlation_id=idempotency_key,
            actor_type="USER",
            actor_id=actor.id,
        )
        executed = await execute_command(
            db,
            context=context,
            payload=request.model_dump(mode="json"),
            handler=lambda command: review_program_match_command(
                db, context=command, request=request
            ),
        )
    return executed.result.response


@router.post("/program-matches/monitoring-selected")
async def set_monitoring_selected(
    actor: StaffActor,
    db: DbSession,
    request: SetMonitoringSelectedRequest,
    idempotency_key: Annotated[str, Depends(require_idempotency_key)],
) -> dict[str, object]:
    await assert_student_access(actor, db, request.student_id)
    await db.rollback()
    async with db.begin():
        context = CommandContext(
            principal_id=actor.id,
            operation="program_match.monitoring_selected",
            idempotency_key=idempotency_key,
            correlation_id=idempotency_key,
            actor_type="USER",
            actor_id=actor.id,
        )
        executed = await execute_command(
            db,
            context=context,
            payload=request.model_dump(mode="json"),
            handler=lambda command: set_monitoring_selected_command(
                db, context=command, request=request
            ),
        )
    return executed.result.response


@router.post("/program-matches/manual")
async def upsert_manual_program_match(
    actor: StaffActor,
    db: DbSession,
    request: UpsertManualProgramMatchRequest,
    idempotency_key: Annotated[str, Depends(require_idempotency_key)],
) -> dict[str, object]:
    await assert_student_access(actor, db, request.student_id)
    await db.rollback()
    async with db.begin():
        context = CommandContext(
            principal_id=actor.id,
            operation="program_match.manual_upsert",
            idempotency_key=idempotency_key,
            correlation_id=idempotency_key,
            actor_type="USER",
            actor_id=actor.id,
        )
        executed = await execute_command(
            db,
            context=context,
            payload=request.model_dump(mode="json"),
            handler=lambda command: upsert_manual_program_match_command(
                db, context=command, request=request
            ),
        )
    return executed.result.response


@router.post("/students/{student_id}/program-matches/replace")
async def replace_program_matches(
    actor: StaffActor,
    db: DbSession,
    student_id: str,
    request: ReplaceProgramMatchesRequest,
    idempotency_key: Annotated[str, Depends(require_idempotency_key)],
) -> dict[str, object]:
    await assert_student_access(actor, db, student_id)
    await db.rollback()
    async with db.begin():
        context = CommandContext(
            principal_id=actor.id,
            operation="program_match.replace",
            idempotency_key=idempotency_key,
            correlation_id=idempotency_key,
            actor_type="USER",
            actor_id=actor.id,
        )
        executed = await execute_command(
            db,
            context=context,
            payload={
                "student_id": student_id,
                **request.model_dump(mode="json"),
            },
            handler=lambda command: replace_program_matches_command(
                db, context=command, student_id=student_id, request=request
            ),
        )
    return executed.result.response


@router.post("/work-queue/dismiss")
async def dismiss_work_queue_item(
    actor: StaffActor,
    db: DbSession,
    request: DismissWorkQueueItemRequest,
    idempotency_key: Annotated[str, Depends(require_idempotency_key)],
) -> dict[str, object]:
    await assert_student_access(actor, db, request.student_id)
    await db.rollback()
    async with db.begin():
        context = CommandContext(
            principal_id=actor.id,
            operation="work_queue.dismiss",
            idempotency_key=idempotency_key,
            correlation_id=idempotency_key,
            actor_type="USER",
            actor_id=actor.id,
        )
        executed = await execute_command(
            db,
            context=context,
            payload=request.model_dump(mode="json"),
            handler=lambda command: dismiss_work_queue_item_command(
                db, context=command, request=request
            ),
        )
    return executed.result.response


@router.post("/program-facts/verify")
async def verify_program_dossier_facts(
    actor: StaffActor,
    db: DbSession,
    request: VerifyProgramDossierFactsRequest,
    idempotency_key: Annotated[str, Depends(require_idempotency_key)],
) -> dict[str, object]:
    if request.student_id:
        await assert_student_access(actor, db, request.student_id)
    await db.rollback()
    async with db.begin():
        context = CommandContext(
            principal_id=actor.id,
            operation="program_fact.manual_verify",
            idempotency_key=idempotency_key,
            correlation_id=idempotency_key,
            actor_type="USER",
            actor_id=actor.id,
        )
        executed = await execute_command(
            db,
            context=context,
            payload=request.model_dump(mode="json"),
            handler=lambda command: verify_program_dossier_facts_command(
                db, context=command, request=request
            ),
        )
    return executed.result.response
