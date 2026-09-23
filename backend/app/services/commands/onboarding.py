from datetime import UTC, datetime
from typing import Any
from uuid import uuid4

from sqlalchemy import insert, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.tables import (
    approval_request_table,
    channel_identity_table,
    conversation_table,
    document_table,
    intake_cohort_table,
    lead_table,
    student_table,
)
from app.events.records import append_audit, append_outbox
from app.services.commands.accompaniment import count_occupied_seats
from app.services.commands.base import CommandContext, CommandResult
from app.services.commands.tasks import create_task_command
from app.services.operations.accompaniment import (
    can_accept_to_cohort,
    normalize_intake_key,
)


async def prepare_onboarding_command(
    db: AsyncSession,
    *,
    context: CommandContext,
    lead_id: str,
    approval_id: str,
) -> CommandResult:
    result = await convert_lead_to_student(
        db,
        lead_id=lead_id,
        approval_id=approval_id,
        idempotency_key=context.idempotency_key,
        agent_key=context.actor_id,
    )
    return CommandResult(
        response=result,
        entity_type="Student",
        entity_id=result.get("student_id"),
    )


async def convert_lead_to_student(
    db: AsyncSession,
    *,
    lead_id: str,
    approval_id: str,
    idempotency_key: str,
    agent_key: str = "onboarding",
) -> dict[str, Any]:
    approval = (
        await db.execute(
            select(approval_request_table).where(
                approval_request_table.c.id == approval_id,
                approval_request_table.c.status == "APPROVED",
                approval_request_table.c.action == "lead.convert",
                approval_request_table.c.subjectType == "Lead",
                approval_request_table.c.subjectId == lead_id,
            )
        )
    ).mappings().first()
    if approval is None:
        raise ValueError("Approved lead conversion is required")
    lead = (
        await db.execute(
            select(lead_table).where(lead_table.c.id == lead_id).with_for_update()
        )
    ).mappings().first()
    if lead is None:
        raise ValueError("Lead not found")
    if lead.convertedStudentId:
        return {
            "lead_id": lead_id,
            "student_id": lead.convertedStudentId,
            "status": "ALREADY_CONVERTED",
        }
    qualification = dict(lead.qualificationJson or {})
    required = ("country", "study_level", "intake", "target_field")
    missing = [key for key in required if not qualification.get(key)]
    if not lead.email:
        missing.append("email")
    if missing:
        raise ValueError(f"Lead qualification is incomplete: {', '.join(missing)}")

    intake = str(qualification["intake"])
    cohort_key = normalize_intake_key(intake) or intake
    cohort = (
        await db.execute(
            select(intake_cohort_table).where(
                intake_cohort_table.c.intake == cohort_key
            )
        )
    ).mappings().first()
    if cohort and cohort.seatLimit is not None:
        occupied = await count_occupied_seats(db, intake)
        ok, _reason = can_accept_to_cohort(occupied, cohort.seatLimit)
        if not ok:
            raise ValueError("Intake cohort capacity is exhausted")

    now = datetime.now(UTC)
    student_id = uuid4().hex
    await db.execute(
        insert(student_table).values(
            id=student_id,
            firstName=lead.firstName or "Student",
            lastName=lead.lastName or "",
            email=lead.email,
            phone=lead.phone,
            country=qualification["country"],
            nationality=qualification.get("nationality"),
            studyLevel=qualification["study_level"],
            intake=intake,
            targetField=qualification["target_field"],
            preferredLanguage=qualification.get("preferred_language"),
            curatorId=lead.assignedCuratorId,
            status="ACTIVE",
            journeyStage="PROFILE",
            riskLevel="NONE",
            accompanimentStatus="ACCEPTED",
            acceptedAt=now,
            createdAt=now,
            updatedAt=now,
        )
    )
    await db.execute(
        update(channel_identity_table)
        .where(channel_identity_table.c.leadId == lead_id)
        .values(leadId=None, studentId=student_id, updatedAt=now)
    )
    await db.execute(
        update(conversation_table)
        .where(conversation_table.c.leadId == lead_id)
        .values(leadId=None, studentId=student_id, updatedAt=now)
    )
    await db.execute(
        update(lead_table)
        .where(lead_table.c.id == lead_id)
        .values(
            status="CONVERTED",
            convertedStudentId=student_id,
            convertedAt=now,
            updatedAt=now,
        )
    )
    for name, category in (
        ("Паспорт", "IDENTITY"),
        ("Документ об образовании", "EDUCATION"),
    ):
        await db.execute(
            insert(document_table).values(
                id=uuid4().hex,
                studentId=student_id,
                name=name,
                category=category,
                status="MISSING",
                updatedAt=now,
                createdAt=now,
            )
        )
    await create_task_command(
        db,
        student_id=student_id,
        title="Заполнить анкету",
        description="Заполните персональную анкету для начала сопровождения.",
        priority="HIGH",
        assignee_id=None,
        application_id=None,
        due_date=None,
        is_student_facing=True,
        actor_type="AGENT",
        actor_id=agent_key,
        correlation_id=idempotency_key,
        idempotency_key=f"onboarding:questionnaire:{idempotency_key}",
        now=now,
    )
    await append_audit(
        db,
        actor_type="AGENT",
        actor_id=agent_key,
        action="lead.convert",
        entity_type="Lead",
        entity_id=lead_id,
        correlation_id=idempotency_key,
        before={"status": lead.status},
        after={"status": "CONVERTED", "studentId": student_id},
        now=now,
    )
    await append_outbox(
        db,
        aggregate_type="Student",
        aggregate_id=student_id,
        event_type="student.onboarded.v1",
        payload={"lead_id": lead_id, "student_id": student_id},
        idempotency_key=f"lead:convert:{idempotency_key}",
        now=now,
    )
    return {"lead_id": lead_id, "student_id": student_id, "status": "CONVERTED"}
