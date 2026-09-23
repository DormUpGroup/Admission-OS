import json
from datetime import UTC, datetime
from typing import Any
from uuid import uuid4

from fastapi import HTTPException, status
from sqlalchemy import insert, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.tables import (
    activity_table,
    application_table,
    application_template_item_table,
    application_template_table,
    deadline_table,
    requirement_table,
    student_table,
)
from app.events.records import append_audit, append_outbox
from app.schemas.applications import (
    AddRequirementRequest,
    CreateApplicationRequest,
    SubmitApplicationRequest,
)
from app.services.commands.base import CommandContext, CommandResult
from app.services.operations.recalculate import recalculate_student


async def add_requirement_command(
    db: AsyncSession,
    *,
    context: CommandContext,
    application_id: str,
    request: AddRequirementRequest,
) -> CommandResult:
    application = (
        await db.execute(
            select(application_table.c.studentId)
            .where(application_table.c.id == application_id)
            .with_for_update()
        )
    ).mappings().first()
    if application is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Application not found"
        )
    now = datetime.now(UTC)
    requirement_id = uuid4().hex
    await db.execute(
        insert(requirement_table).values(
            id=requirement_id,
            applicationId=application_id,
            name=request.name.strip(),
            type=request.type,
            status="MISSING",
            isCritical=request.is_critical,
            createdAt=now,
        )
    )
    await append_audit(
        db,
        actor_type=context.actor_type,
        actor_id=context.actor_id,
        user_id=context.actor_id,
        action="requirement.create",
        entity_type="Requirement",
        entity_id=requirement_id,
        correlation_id=context.correlation_id,
        after={
            "applicationId": application_id,
            "name": request.name.strip(),
            "isCritical": request.is_critical,
        },
        now=now,
    )
    await append_outbox(
        db,
        aggregate_type="Application",
        aggregate_id=application_id,
        event_type="requirement.created.v1",
        payload={
            "requirement_id": requirement_id,
            "application_id": application_id,
            "student_id": application.studentId,
        },
        idempotency_key=f"requirement:create:{context.idempotency_key}",
        now=now,
    )
    await recalculate_student(db, application.studentId, now)
    return CommandResult(
        response={"id": requirement_id},
        http_status=status.HTTP_201_CREATED,
        entity_type="Requirement",
        entity_id=requirement_id,
    )


async def create_application_command(
    db: AsyncSession,
    *,
    context: CommandContext,
    request: CreateApplicationRequest,
    program: dict[str, Any],
    student_initiated: bool,
) -> CommandResult:
    now = datetime.now(UTC)
    existing = (
        await db.execute(
            select(application_table.c.id).where(
                application_table.c.studentId == request.student_id,
                application_table.c.programId == request.program_id,
            )
        )
    ).scalar_one_or_none()
    if existing:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Application already exists",
        )
    application_id = uuid4().hex
    application_status = "SELECTED" if student_initiated else "PREPARING"
    await db.execute(
        insert(application_table).values(
            id=application_id,
            studentId=request.student_id,
            programId=request.program_id,
            programAcademicYearId=request.program_academic_year_id,
            intake=request.intake,
            applicationRound=request.application_round,
            status=application_status,
            hardDeadline=request.hard_deadline,
            targetSubmissionDate=request.target_submission_date,
            readinessPercent=0,
            riskLevel="NONE",
            version=1,
            applicationFeePaid=False,
            createdAt=now,
            updatedAt=now,
        )
    )
    requirement_response: list[dict[str, Any]] = []
    if request.template_id:
        template = (
            await db.execute(
                select(application_template_table.c.id).where(
                    application_template_table.c.id == request.template_id
                )
            )
        ).scalar_one_or_none()
        if template is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Application template not found",
            )
        items = (
            await db.execute(
                select(application_template_item_table).where(
                    application_template_item_table.c.templateId
                    == request.template_id
                )
            )
        ).mappings().all()
        for item in items:
            requirement_id = uuid4().hex
            await db.execute(
                insert(requirement_table).values(
                    id=requirement_id,
                    applicationId=application_id,
                    name=item.name,
                    type=item.type,
                    status="MISSING",
                    isCritical=item.isCritical,
                    createdAt=now,
                )
            )
            requirement_response.append(
                {
                    "id": requirement_id,
                    "name": item.name,
                    "type": item.type,
                    "status": "MISSING",
                    "is_critical": item.isCritical,
                    "related_document_id": None,
                    "due_date": None,
                }
            )
    if request.hard_deadline:
        await db.execute(
            insert(deadline_table).values(
                id=uuid4().hex,
                title=f"{program['university_name']} hard deadline",
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
            userId=context.actor_id if context.actor_type == "USER" else None,
            metadata=json.dumps(
                {
                    "university": program["university_name"],
                    "program": program["name"],
                    "source": "student_request"
                    if student_initiated
                    else "python-command",
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
            .values(
                journeyStage="APPLICATIONS",
                version=student_table.c.version + 1,
                updatedAt=now,
            )
        )
    await append_audit(
        db,
        actor_type=context.actor_type,
        actor_id=context.actor_id,
        user_id=context.actor_id if context.actor_type == "USER" else None,
        action="application.create",
        entity_type="Application",
        entity_id=application_id,
        correlation_id=context.correlation_id,
        after={
            "studentId": request.student_id,
            "programId": request.program_id,
            "status": application_status,
        },
        now=now,
    )
    await append_outbox(
        db,
        aggregate_type="Application",
        aggregate_id=application_id,
        event_type="application.created.v1",
        payload={
            "application_id": application_id,
            "student_id": request.student_id,
        },
        idempotency_key=f"application:create:{context.idempotency_key}",
        now=now,
    )
    await recalculate_student(db, request.student_id, now)
    return CommandResult(
        response={
            "id": application_id,
            "student_id": request.student_id,
            "status": application_status,
            "intake": request.intake,
            "hard_deadline": request.hard_deadline,
            "target_submission_date": request.target_submission_date,
            "readiness_percent": 0,
            "risk_level": "NONE",
            "program": {
                "id": program["id"],
                "name": program["name"],
                "university_name": program["university_name"],
            },
            "requirements": requirement_response,
        },
        http_status=status.HTTP_201_CREATED,
        entity_type="Application",
        entity_id=application_id,
    )


async def update_application_status_command(
    db: AsyncSession,
    *,
    context: CommandContext,
    application_id: str,
    new_status: str,
) -> CommandResult:
    application = (
        await db.execute(
            select(application_table)
            .where(application_table.c.id == application_id)
            .with_for_update()
        )
    ).mappings().first()
    if application is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Application not found"
        )
    if application.status == new_status:
        return CommandResult(
            response={"id": application_id, "status": new_status},
            http_status=status.HTTP_204_NO_CONTENT,
            entity_type="Application",
            entity_id=application_id,
        )
    now = datetime.now(UTC)
    await db.execute(
        update(application_table)
        .where(application_table.c.id == application_id)
        .values(
            status=new_status,
            version=application_table.c.version + 1,
            updatedAt=now,
        )
    )
    await db.execute(
        insert(activity_table).values(
            id=uuid4().hex,
            type="APPLICATION_STATUS_CHANGED",
            studentId=application.studentId,
            applicationId=application_id,
            userId=context.actor_id if context.actor_type == "USER" else None,
            metadata=json.dumps(
                {
                    "from": application.status,
                    "to": new_status,
                    "source": "python-command",
                }
            ),
            createdAt=now,
        )
    )
    await append_audit(
        db,
        actor_type=context.actor_type,
        actor_id=context.actor_id,
        user_id=context.actor_id if context.actor_type == "USER" else None,
        action="application.status.update",
        entity_type="Application",
        entity_id=application_id,
        correlation_id=context.correlation_id,
        before={"status": application.status, "version": application.version},
        after={"status": new_status, "version": application.version + 1},
        now=now,
    )
    await append_outbox(
        db,
        aggregate_type="Application",
        aggregate_id=application_id,
        event_type="application.status_changed.v1",
        payload={
            "application_id": application_id,
            "student_id": application.studentId,
            "from": application.status,
            "to": new_status,
        },
        idempotency_key=f"application:status:{context.idempotency_key}",
        now=now,
    )
    await recalculate_student(db, application.studentId, now)
    return CommandResult(
        response={"id": application_id, "status": new_status},
        http_status=status.HTTP_204_NO_CONTENT,
        entity_type="Application",
        entity_id=application_id,
    )


async def submit_application_command(
    db: AsyncSession,
    *,
    context: CommandContext,
    application_id: str,
    request: SubmitApplicationRequest,
    actor_role: str,
) -> CommandResult:
    application = (
        await db.execute(
            select(application_table)
            .where(application_table.c.id == application_id)
            .with_for_update()
        )
    ).mappings().first()
    if application is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Application not found"
        )
    if application.status == "SUBMITTED":
        return CommandResult(
            response={"ok": True},
            entity_type="Application",
            entity_id=application_id,
        )
    requirements = (
        await db.execute(
            select(
                requirement_table.c.name,
                requirement_table.c.status,
                requirement_table.c.isCritical,
            ).where(requirement_table.c.applicationId == application_id)
        )
    ).mappings().all()
    blockers = [
        row.name
        for row in requirements
        if row.isCritical and row.status not in {"COMPLETED", "NOT_APPLICABLE"}
    ]
    if blockers and not (request.force and actor_role == "ADMIN"):
        return CommandResult(
            response={"ok": False, "warning": True, "blockers": blockers},
            entity_type="Application",
            entity_id=application_id,
        )
    now = datetime.now(UTC)
    await db.execute(
        update(application_table)
        .where(application_table.c.id == application_id)
        .values(
            status="SUBMITTED",
            submittedAt=now,
            applicationIdExternal=request.application_id_external,
            submissionConfirmationNote=request.submission_confirmation_note,
            applicationFeePaid=request.application_fee_paid
            or application.applicationFeePaid,
            riskLevel="NONE",
            version=application_table.c.version + 1,
            updatedAt=now,
        )
    )
    await db.execute(
        insert(activity_table).values(
            id=uuid4().hex,
            type="APPLICATION_SUBMITTED",
            studentId=application.studentId,
            applicationId=application_id,
            userId=context.actor_id if context.actor_type == "USER" else None,
            metadata=json.dumps(
                {
                    "applicationIdExternal": request.application_id_external,
                    "source": "python-command",
                }
            ),
            createdAt=now,
        )
    )
    await append_audit(
        db,
        actor_type=context.actor_type,
        actor_id=context.actor_id,
        user_id=context.actor_id if context.actor_type == "USER" else None,
        action="application.submit",
        entity_type="Application",
        entity_id=application_id,
        correlation_id=context.correlation_id,
        before={"status": application.status, "version": application.version},
        after={"status": "SUBMITTED", "version": application.version + 1},
        now=now,
    )
    await append_outbox(
        db,
        aggregate_type="Application",
        aggregate_id=application_id,
        event_type="application.submitted.v1",
        payload={
            "application_id": application_id,
            "student_id": application.studentId,
        },
        idempotency_key=f"application:submit:{context.idempotency_key}",
        now=now,
    )
    await recalculate_student(db, application.studentId, now)
    return CommandResult(
        response={"ok": True},
        entity_type="Application",
        entity_id=application_id,
    )
