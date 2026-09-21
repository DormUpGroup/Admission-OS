import json
from datetime import UTC, datetime
from typing import Annotated
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy import insert, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import CurrentActor, StaffActor
from app.db.session import get_db_session
from app.db.tables import (
    activity_table,
    application_table,
    deadline_table,
    program_academic_year_table,
    program_table,
    requirement_table,
    student_table,
    university_table,
)
from app.schemas.applications import (
    ApplicationProgram,
    ApplicationSummary,
    CreateApplicationRequest,
    RequirementSummary,
    SubmitApplicationRequest,
    UpdateApplicationStatusRequest,
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
    existing = (
        (
            await db.execute(
                select(application_table.c.id).where(
                    application_table.c.studentId == request.student_id,
                    application_table.c.programId == request.program_id,
                )
            )
        )
        .mappings()
        .first()
    )
    if existing:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="Application already exists"
        )
    now = datetime.now(UTC)
    application_id = uuid4().hex
    app_status = "SELECTED" if student_initiated else "PREPARING"
    await db.rollback()
    async with db.begin():
        await db.execute(
            insert(application_table).values(
                id=application_id,
                studentId=request.student_id,
                programId=request.program_id,
                programAcademicYearId=request.program_academic_year_id,
                intake=request.intake,
                applicationRound=request.application_round,
                status=app_status,
                hardDeadline=request.hard_deadline,
                targetSubmissionDate=request.target_submission_date,
                readinessPercent=0,
                riskLevel="NONE",
                applicationFeePaid=False,
                createdAt=now,
                updatedAt=now,
            )
        )
        if request.hard_deadline:
            await db.execute(
                insert(deadline_table).values(
                    id=uuid4().hex,
                    title=f"{program.university_name} hard deadline",
                    date=request.hard_deadline,
                    type="HARD",
                    studentId=request.student_id,
                    applicationId=application_id,
                    isHardDeadline=True,
                    isInternal=False,
                    riskWeight=3,
                    createdAt=now,
                    updatedAt=now,
                )
            )
        await db.execute(
            insert(activity_table).values(
                id=uuid4().hex,
                type="APPLICATION_CREATED",
                studentId=request.student_id,
                applicationId=application_id,
                userId=actor.id,
                metadata=json.dumps(
                    {
                        "university": program.university_name,
                        "program": program.name,
                        "source": "student_request" if student_initiated else "python-api",
                    }
                ),
                createdAt=now,
            )
        )
        if student_initiated:
            await db.execute(
                update(student_table)
                .where(
                    student_table.c.id == request.student_id,
                    student_table.c.journeyStage.in_(["PROFILE", "STRATEGY", "PROGRAMS"]),
                )
                .values(journeyStage="APPLICATIONS")
            )
    return ApplicationSummary(
        id=application_id,
        student_id=request.student_id,
        status=app_status,
        intake=request.intake,
        hard_deadline=request.hard_deadline,
        target_submission_date=request.target_submission_date,
        readiness_percent=0,
        risk_level="NONE",
        program=ApplicationProgram(
            id=program.id, name=program.name, university_name=program.university_name
        ),
        requirements=[],
    )


@router.post(
    "/applications", response_model=ApplicationSummary, status_code=status.HTTP_201_CREATED
)
async def create_application(
    actor: StaffActor, db: DbSession, request: CreateApplicationRequest
) -> ApplicationSummary:
    return await _create_application(actor, db, request, student_initiated=False)


@router.post(
    "/portal/applications", response_model=ApplicationSummary, status_code=status.HTTP_201_CREATED
)
async def request_application(
    actor: CurrentActor, db: DbSession, request: CreateApplicationRequest
) -> ApplicationSummary:
    return await _create_application(actor, db, request, student_initiated=True)


@router.patch("/applications/{application_id}/status", status_code=status.HTTP_204_NO_CONTENT)
async def update_application_status(
    actor: StaffActor, db: DbSession, application_id: str, request: UpdateApplicationStatusRequest
) -> Response:
    application = await _application_for_actor(actor, db, application_id)
    now = datetime.now(UTC)
    await db.rollback()
    async with db.begin():
        await db.execute(
            update(application_table)
            .where(application_table.c.id == application_id)
            .values(status=request.status, updatedAt=now)
        )
        await db.execute(
            insert(activity_table).values(
                id=uuid4().hex,
                type="APPLICATION_STATUS_CHANGED",
                studentId=application.studentId,
                applicationId=application_id,
                userId=actor.id,
                metadata=json.dumps(
                    {"from": application.status, "to": request.status, "source": "python-api"}
                ),
                createdAt=now,
            )
        )
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/applications/{application_id}/submit")
async def submit_application(
    actor: StaffActor, db: DbSession, application_id: str, request: SubmitApplicationRequest
) -> dict[str, object]:
    application = await _application_for_actor(actor, db, application_id)
    requirements = (
        (
            await db.execute(
                select(
                    requirement_table.c.name,
                    requirement_table.c.status,
                    requirement_table.c.isCritical,
                ).where(requirement_table.c.applicationId == application_id)
            )
        )
        .mappings()
        .all()
    )
    blockers = [
        row.name
        for row in requirements
        if row.isCritical and row.status not in {"COMPLETED", "NOT_APPLICABLE"}
    ]
    if blockers and not (request.force and actor.role == "ADMIN"):
        return {"ok": False, "warning": True, "blockers": blockers}
    now = datetime.now(UTC)
    await db.rollback()
    async with db.begin():
        await db.execute(
            update(application_table)
            .where(application_table.c.id == application_id)
            .values(
                status="SUBMITTED",
                submittedAt=now,
                applicationIdExternal=request.application_id_external,
                submissionConfirmationNote=request.submission_confirmation_note,
                applicationFeePaid=request.application_fee_paid or application.applicationFeePaid,
                riskLevel="NONE",
                updatedAt=now,
            )
        )
        await db.execute(
            insert(activity_table).values(
                id=uuid4().hex,
                type="APPLICATION_SUBMITTED",
                studentId=application.studentId,
                applicationId=application_id,
                userId=actor.id,
                metadata=json.dumps(
                    {
                        "applicationIdExternal": request.application_id_external,
                        "source": "python-api",
                    }
                ),
                createdAt=now,
            )
        )
    return {"ok": True}
