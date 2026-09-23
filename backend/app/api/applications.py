from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import CurrentActor, StaffActor
from app.db.session import get_db_session
from app.db.tables import (
    application_table,
    program_academic_year_table,
    program_table,
    requirement_table,
    student_table,
    university_table,
)
from app.schemas.applications import (
    AddRequirementRequest,
    ApplicationProgram,
    ApplicationSummary,
    CreateApplicationRequest,
    RequirementSummary,
    SubmitApplicationRequest,
    UpdateApplicationStatusRequest,
)
from app.services.commands.applications import (
    add_requirement_command,
    create_application_command,
    submit_application_command,
    update_application_status_command,
)
from app.services.commands.base import (
    CommandContext,
    execute_command,
    require_idempotency_key,
)

router = APIRouter(tags=["applications"])
DbSession = Annotated[AsyncSession, Depends(get_db_session)]


async def assert_student_access(actor: StaffActor, db: AsyncSession, student_id: str) -> None:
    row = (
        (
            await db.execute(
                select(student_table.c.curatorId).where(student_table.c.id == student_id)
            )
        )
        .mappings()
        .first()
    )
    if row is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Student not found")
    if actor.role == "CURATOR" and row.curatorId not in {actor.id, None}:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Student access denied")


@router.get("/students/{student_id}/applications", response_model=list[ApplicationSummary])
async def list_student_applications(
    actor: StaffActor, db: DbSession, student_id: str
) -> list[ApplicationSummary]:
    await assert_student_access(actor, db, student_id)
    statement = (
        select(
            application_table,
            program_table.c.id.label("program_id"),
            program_table.c.name.label("program_name"),
            university_table.c.name.label("university_name"),
        )
        .join(program_table, program_table.c.id == application_table.c.programId)
        .join(university_table, university_table.c.id == program_table.c.universityId)
        .where(application_table.c.studentId == student_id)
        .order_by(application_table.c.hardDeadline.asc().nulls_last())
    )
    applications = (await db.execute(statement)).mappings().all()
    if not applications:
        return []
    application_ids = [row.id for row in applications]
    requirements = (
        await db.execute(
            select(requirement_table)
            .where(requirement_table.c.applicationId.in_(application_ids))
            .order_by(requirement_table.c.createdAt)
        )
    ).mappings()
    by_application: dict[str, list[RequirementSummary]] = {app_id: [] for app_id in application_ids}
    for requirement in requirements:
        by_application[requirement.applicationId].append(
            RequirementSummary(
                id=requirement.id,
                name=requirement.name,
                type=requirement.type,
                status=requirement.status,
                is_critical=requirement.isCritical,
                related_document_id=requirement.relatedDocumentId,
                due_date=requirement.dueDate,
            )
        )
    return [
        ApplicationSummary(
            id=row.id,
            student_id=row.studentId,
            status=row.status,
            intake=row.intake,
            hard_deadline=row.hardDeadline,
            target_submission_date=row.targetSubmissionDate,
            readiness_percent=row.readinessPercent,
            risk_level=row.riskLevel,
            program=ApplicationProgram(
                id=row.program_id,
                name=row.program_name,
                university_name=row.university_name,
            ),
            requirements=by_application[row.id],
        )
        for row in applications
    ]


async def _application_for_actor(actor: CurrentActor, db: AsyncSession, application_id: str):
    row = (
        (
            await db.execute(
                select(application_table, student_table.c.curatorId, student_table.c.userId)
                .join(student_table, student_table.c.id == application_table.c.studentId)
                .where(application_table.c.id == application_id)
            )
        )
        .mappings()
        .first()
    )
    if row is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Application not found")
    if actor.role == "STUDENT" and row.userId != actor.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, detail="Application access denied"
        )
    if actor.role == "CURATOR" and row.curatorId not in {actor.id, None}:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Student access denied")
    return row


async def _create_application(
    actor: CurrentActor,
    db: AsyncSession,
    request: CreateApplicationRequest,
    *,
    student_initiated: bool,
    idempotency_key: str,
) -> ApplicationSummary:
    if student_initiated:
        if actor.role != "STUDENT":
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN, detail="Student access required"
            )
        student = (
            (
                await db.execute(
                    select(student_table).where(student_table.c.id == request.student_id)
                )
            )
            .mappings()
            .first()
        )
        if student is None or student.userId != actor.id:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN, detail="Student access denied"
            )
    else:
        await assert_student_access(actor, db, request.student_id)
    program = (
        (
            await db.execute(
                select(
                    program_table.c.id,
                    program_table.c.name,
                    university_table.c.name.label("university_name"),
                )
                .join(university_table, university_table.c.id == program_table.c.universityId)
                .where(program_table.c.id == request.program_id)
            )
        )
        .mappings()
        .first()
    )
    if program is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Program not found")
    if request.program_academic_year_id:
        year = (
            (
                await db.execute(
                    select(program_academic_year_table.c.id).where(
                        program_academic_year_table.c.id == request.program_academic_year_id,
                        program_academic_year_table.c.programId == request.program_id,
                    )
                )
            )
            .mappings()
            .first()
        )
        if year is None:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                detail="Academic year does not belong to program",
            )
    await db.rollback()
    async with db.begin():
        context = CommandContext(
            principal_id=actor.id,
            operation=(
                "portal.application.create"
                if student_initiated
                else "application.create"
            ),
            idempotency_key=idempotency_key,
            correlation_id=idempotency_key,
            actor_type="USER",
            actor_id=actor.id,
        )
        executed = await execute_command(
            db,
            context=context,
            payload=request.model_dump(mode="json"),
            handler=lambda command: create_application_command(
                db,
                context=command,
                request=request,
                program=dict(program),
                student_initiated=student_initiated,
            ),
        )
    return ApplicationSummary.model_validate(executed.result.response)


@router.post(
    "/applications", response_model=ApplicationSummary, status_code=status.HTTP_201_CREATED
)
async def create_application(
    actor: StaffActor,
    db: DbSession,
    request: CreateApplicationRequest,
    idempotency_key: Annotated[str, Depends(require_idempotency_key)],
) -> ApplicationSummary:
    return await _create_application(
        actor,
        db,
        request,
        student_initiated=False,
        idempotency_key=idempotency_key,
    )


@router.post(
    "/portal/applications", response_model=ApplicationSummary, status_code=status.HTTP_201_CREATED
)
async def request_application(
    actor: CurrentActor,
    db: DbSession,
    request: CreateApplicationRequest,
    idempotency_key: Annotated[str, Depends(require_idempotency_key)],
) -> ApplicationSummary:
    return await _create_application(
        actor,
        db,
        request,
        student_initiated=True,
        idempotency_key=idempotency_key,
    )


@router.patch("/applications/{application_id}/status", status_code=status.HTTP_204_NO_CONTENT)
async def update_application_status(
    actor: StaffActor,
    db: DbSession,
    application_id: str,
    request: UpdateApplicationStatusRequest,
    idempotency_key: Annotated[str, Depends(require_idempotency_key)],
) -> Response:
    await _application_for_actor(actor, db, application_id)
    await db.rollback()
    async with db.begin():
        context = CommandContext(
            principal_id=actor.id,
            operation="application.status.update",
            idempotency_key=idempotency_key,
            correlation_id=idempotency_key,
            actor_type="USER",
            actor_id=actor.id,
        )
        await execute_command(
            db,
            context=context,
            payload={"application_id": application_id, **request.model_dump(mode="json")},
            handler=lambda command: update_application_status_command(
                db,
                context=command,
                application_id=application_id,
                new_status=request.status,
            ),
        )
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/applications/{application_id}/submit")
async def submit_application(
    actor: StaffActor,
    db: DbSession,
    application_id: str,
    request: SubmitApplicationRequest,
    idempotency_key: Annotated[str, Depends(require_idempotency_key)],
) -> dict[str, object]:
    await _application_for_actor(actor, db, application_id)
    await db.rollback()
    async with db.begin():
        context = CommandContext(
            principal_id=actor.id,
            operation="application.submit",
            idempotency_key=idempotency_key,
            correlation_id=idempotency_key,
            actor_type="USER",
            actor_id=actor.id,
        )
        executed = await execute_command(
            db,
            context=context,
            payload={"application_id": application_id, **request.model_dump(mode="json")},
            handler=lambda command: submit_application_command(
                db,
                context=command,
                application_id=application_id,
                request=request,
                actor_role=actor.role,
            ),
        )
    return executed.result.response


@router.post(
    "/applications/{application_id}/requirements",
    status_code=status.HTTP_201_CREATED,
)
async def add_requirement(
    actor: StaffActor,
    db: DbSession,
    application_id: str,
    request: AddRequirementRequest,
    idempotency_key: Annotated[str, Depends(require_idempotency_key)],
) -> dict[str, str]:
    await _application_for_actor(actor, db, application_id)
    await db.rollback()
    async with db.begin():
        context = CommandContext(
            principal_id=actor.id,
            operation="requirement.create",
            idempotency_key=idempotency_key,
            correlation_id=idempotency_key,
            actor_type="USER",
            actor_id=actor.id,
        )
        executed = await execute_command(
            db,
            context=context,
            payload={"application_id": application_id, **request.model_dump()},
            handler=lambda command: add_requirement_command(
                db,
                context=command,
                application_id=application_id,
                request=request,
            ),
        )
    return executed.result.response
