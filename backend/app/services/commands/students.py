import json
from datetime import UTC, datetime
from uuid import uuid4

from fastapi import HTTPException, status
from sqlalchemy import insert, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.tables import activity_table, student_table
from app.events.records import append_audit, append_outbox
from app.schemas.students import CreateStudentRequest, UpdateStudentRequest
from app.services.commands.base import CommandContext, CommandResult
from app.services.operations.recalculate import recalculate_student

_FIELD_MAP = {
    "first_name": "firstName",
    "last_name": "lastName",
    "phone": "phone",
    "country": "country",
    "nationality": "nationality",
    "study_level": "studyLevel",
    "intake": "intake",
    "target_field": "targetField",
    "preferred_language": "preferredLanguage",
    "preferred_cities": "preferredCities",
    "questionnaire_at": "questionnaireAt",
    "questionnaire_personal_json": "questionnairePersonalJson",
    "questionnaire_programs_json": "questionnaireProgramsJson",
    "questionnaire_programs_at": "questionnaireProgramsAt",
    "status": "status",
    "journey_stage": "journeyStage",
    "curator_id": "curatorId",
    "accompaniment_status": "accompanimentStatus",
}


async def create_student_command(
    db: AsyncSession,
    *,
    context: CommandContext,
    request: CreateStudentRequest,
) -> CommandResult:
    existing = (
        await db.execute(
            select(student_table.c.id).where(
                student_table.c.email == request.email.strip()
            )
        )
    ).scalar_one_or_none()
    if existing:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Student email already exists",
        )
    now = datetime.now(UTC)
    student_id = uuid4().hex
    await db.execute(
        insert(student_table).values(
            id=student_id,
            firstName=request.first_name.strip(),
            lastName=request.last_name.strip(),
            email=request.email.strip(),
            phone=request.phone,
            country=request.country,
            nationality=request.nationality,
            studyLevel=request.study_level,
            intake=request.intake,
            targetField=request.target_field,
            preferredLanguage=request.preferred_language,
            curatorId=request.curator_id,
            status="ACTIVE",
            journeyStage="PROFILE",
            riskLevel="NONE",
            accompanimentStatus="NONE",
            version=1,
            createdAt=now,
            updatedAt=now,
        )
    )
    await db.execute(
        insert(activity_table).values(
            id=uuid4().hex,
            type="STUDENT_CREATED",
            studentId=student_id,
            userId=context.actor_id,
            metadata='{"source":"python-command"}',
            createdAt=now,
        )
    )
    await append_audit(
        db,
        actor_type=context.actor_type,
        actor_id=context.actor_id,
        user_id=context.actor_id,
        action="student.create",
        entity_type="Student",
        entity_id=student_id,
        correlation_id=context.correlation_id,
        after={
            "email": request.email.strip(),
            "status": "ACTIVE",
            "journeyStage": "PROFILE",
        },
        now=now,
    )
    await append_outbox(
        db,
        aggregate_type="Student",
        aggregate_id=student_id,
        event_type="student.created.v1",
        payload={"student_id": student_id},
        idempotency_key=f"student:create:{context.idempotency_key}",
        now=now,
    )
    await recalculate_student(db, student_id, now)
    return CommandResult(
        response={"id": student_id},
        http_status=status.HTTP_201_CREATED,
        entity_type="Student",
        entity_id=student_id,
    )


async def update_student_command(
    db: AsyncSession,
    *,
    context: CommandContext,
    student_id: str,
    request: UpdateStudentRequest,
) -> CommandResult:
    student = (
        await db.execute(
            select(student_table)
            .where(student_table.c.id == student_id)
            .with_for_update()
        )
    ).mappings().first()
    if student is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Student not found"
        )
    requested = request.model_dump(exclude_unset=True)
    mark_questionnaire_at = requested.pop("mark_questionnaire_at", False)
    mark_questionnaire_programs_at = requested.pop(
        "mark_questionnaire_programs_at", False
    )
    values = {_FIELD_MAP[key]: value for key, value in requested.items()}
    now = datetime.now(UTC)
    if mark_questionnaire_at:
        values["questionnaireAt"] = now
        requested["questionnaire_at"] = now
    if mark_questionnaire_programs_at:
        values["questionnaireProgramsAt"] = now
        requested["questionnaire_programs_at"] = now
    if not values:
        return CommandResult(
            response={"id": student_id, "version": student.version},
            entity_type="Student",
            entity_id=student_id,
        )
    values.update(version=student_table.c.version + 1, updatedAt=now)
    await db.execute(
        update(student_table).where(student_table.c.id == student_id).values(**values)
    )
    await db.execute(
        insert(activity_table).values(
            id=uuid4().hex,
            type="STUDENT_UPDATED",
            studentId=student_id,
            userId=context.actor_id,
            metadata=json.dumps(
                {"fields": sorted(requested), "source": "python-command"}
            ),
            createdAt=now,
        )
    )
    await append_audit(
        db,
        actor_type=context.actor_type,
        actor_id=context.actor_id,
        user_id=context.actor_id,
        action="student.update",
        entity_type="Student",
        entity_id=student_id,
        correlation_id=context.correlation_id,
        before={
            key: student[_FIELD_MAP[key]]
            for key in requested
            if _FIELD_MAP[key] in student
        },
        after={**requested, "version": student.version + 1},
        now=now,
    )
    await append_outbox(
        db,
        aggregate_type="Student",
        aggregate_id=student_id,
        event_type="student.updated.v1",
        payload={"student_id": student_id, "fields": sorted(requested)},
        idempotency_key=f"student:update:{context.idempotency_key}",
        now=now,
    )
    await recalculate_student(db, student_id, now)
    return CommandResult(
        response={"id": student_id, "version": student.version + 1},
        entity_type="Student",
        entity_id=student_id,
    )
