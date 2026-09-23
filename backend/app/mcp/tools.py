from datetime import UTC, datetime, time, timedelta
from typing import Any
from zoneinfo import ZoneInfo

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.tables import (
    application_table,
    appointment_table,
    conversation_message_table,
    conversation_table,
    deadline_table,
    document_table,
    lead_table,
    student_table,
    task_table,
)
from app.mcp.registry import ToolDefinition, register_tool
from app.services.commands.appointments import (
    create_appointment_command,
    request_scheduling_command,
)
from app.services.commands.base import (
    IdempotencyConflictError,
    agent_context,
    execute_command,
)
from app.services.commands.documents import request_document_command
from app.services.commands.leads import update_lead_qualification_command
from app.services.commands.messages import (
    propose_message_command,
    request_send_message_command,
)
from app.services.commands.onboarding import prepare_onboarding_command
from app.services.commands.tasks import create_task_from_context


def _required(arguments: dict[str, Any], name: str) -> str:
    value = str(arguments.get(name) or "").strip()
    if not value:
        raise ValueError(f"{name} is required")
    return value


def _aware(value: datetime) -> datetime:
    return value if value.tzinfo else value.replace(tzinfo=UTC)


def _agent_run_id(arguments: dict[str, Any]) -> str:
    return (
        str(arguments.get("agent_run_id") or "").strip()
        or str(arguments.get("agent_key") or "").strip()
        or "mcp"
    )


async def _run_agent_command(
    db: AsyncSession,
    *,
    arguments: dict[str, Any],
    operation: str,
    payload: dict[str, Any],
    handler,
) -> dict[str, Any]:
    idempotency_key = _required(arguments, "idempotency_key")
    context = agent_context(
        agent_run_id=_agent_run_id(arguments),
        operation=operation,
        idempotency_key=idempotency_key,
        actor_id=str(arguments.get("agent_key") or _agent_run_id(arguments)),
    )
    try:
        executed = await execute_command(
            db,
            context=context,
            payload=payload,
            handler=handler,
        )
    except IdempotencyConflictError as error:
        raise ValueError(str(error)) from error
    return executed.result.response


async def lead_get(db: AsyncSession, arguments: dict[str, Any]) -> dict[str, Any]:
    lead_id = _required(arguments, "lead_id")
    row = (
        await db.execute(select(lead_table).where(lead_table.c.id == lead_id))
    ).mappings().first()
    if row is None:
        raise ValueError("Lead not found")
    return {
        "id": row.id,
        "first_name": row.firstName,
        "last_name": row.lastName,
        "email": row.email,
        "phone": row.phone,
        "status": row.status,
        "locale": row.locale,
        "consent_status": row.consentStatus,
        "qualification": row.qualificationJson or {},
        "converted_student_id": row.convertedStudentId,
    }


async def lead_update_qualification(
    db: AsyncSession, arguments: dict[str, Any]
) -> dict[str, Any]:
    lead_id = _required(arguments, "lead_id")
    fields = arguments.get("fields")
    if not isinstance(fields, dict):
        raise ValueError("fields must be an object")
    return await _run_agent_command(
        db,
        arguments=arguments,
        operation="lead.qualification.update",
        payload={"lead_id": lead_id, "fields": fields},
        handler=lambda context: update_lead_qualification_command(
            db, context=context, lead_id=lead_id, fields=fields
        ),
    )


async def conversation_recent(
    db: AsyncSession, arguments: dict[str, Any]
) -> dict[str, Any]:
    conversation_id = _required(arguments, "conversation_id")
    limit = max(1, min(int(arguments.get("limit") or 20), 50))
    conversation = (
        await db.execute(
            select(conversation_table).where(conversation_table.c.id == conversation_id)
        )
    ).mappings().first()
    if conversation is None:
        raise ValueError("Conversation not found")
    rows = (
        await db.execute(
            select(conversation_message_table)
            .where(conversation_message_table.c.conversationId == conversation_id)
            .order_by(conversation_message_table.c.createdAt.desc())
            .limit(limit)
        )
    ).mappings()
    messages = [
        {
            "id": row.id,
            "direction": row.direction,
            "sender_type": row.senderType,
            "body": row.body,
            "created_at": row.createdAt.isoformat(),
        }
        for row in reversed(list(rows))
    ]
    return {
        "conversation_id": conversation_id,
        "automation_paused": conversation.automationPausedAt is not None,
        "lead_id": conversation.leadId,
        "student_id": conversation.studentId,
        "messages": messages,
    }


async def message_propose(
    db: AsyncSession, arguments: dict[str, Any]
) -> dict[str, Any]:
    conversation_id = _required(arguments, "conversation_id")
    text = _required(arguments, "text")
    return await _run_agent_command(
        db,
        arguments=arguments,
        operation="message.propose",
        payload={"conversation_id": conversation_id, "text": text},
        handler=lambda context: propose_message_command(
            db, context=context, conversation_id=conversation_id, text=text
        ),
    )


async def message_request_send(
    db: AsyncSession, arguments: dict[str, Any]
) -> dict[str, Any]:
    message_id = _required(arguments, "message_id")
    template_key = str(arguments.get("template_key") or "").strip() or None
    return await _run_agent_command(
        db,
        arguments=arguments,
        operation="message.request_send",
        payload={"message_id": message_id, "template_key": template_key},
        handler=lambda context: request_send_message_command(
            db,
            context=context,
            message_id=message_id,
            template_key=template_key,
        ),
    )


async def task_create(db: AsyncSession, arguments: dict[str, Any]) -> dict[str, Any]:
    student_id = _required(arguments, "student_id")
    title = _required(arguments, "title")
    description = str(arguments.get("description") or "") or None
    priority = str(arguments.get("priority") or "MEDIUM")
    assignee_id = str(arguments.get("assignee_id") or "") or None
    application_id = str(arguments.get("application_id") or "") or None
    is_student_facing = bool(arguments.get("is_student_facing", False))
    return await _run_agent_command(
        db,
        arguments=arguments,
        operation="task.create",
        payload={
            "student_id": student_id,
            "title": title,
            "description": description,
            "priority": priority,
            "assignee_id": assignee_id,
            "application_id": application_id,
            "is_student_facing": is_student_facing,
        },
        handler=lambda context: create_task_from_context(
            db,
            context=context,
            student_id=student_id,
            title=title,
            description=description,
            priority=priority,
            assignee_id=assignee_id,
            application_id=application_id,
            is_student_facing=is_student_facing,
        ),
    )


async def case_snapshot(db: AsyncSession, arguments: dict[str, Any]) -> dict[str, Any]:
    student_id = _required(arguments, "student_id")
    student = (
        await db.execute(select(student_table).where(student_table.c.id == student_id))
    ).mappings().first()
    if student is None:
        raise ValueError("Student not found")
    tasks = (
        await db.execute(
            select(task_table).where(
                task_table.c.studentId == student_id, task_table.c.status != "DONE"
            )
        )
    ).mappings()
    documents = (
        await db.execute(
            select(document_table).where(document_table.c.studentId == student_id)
        )
    ).mappings()
    applications = (
        await db.execute(
            select(application_table).where(application_table.c.studentId == student_id)
        )
    ).mappings()
    deadlines = (
        await db.execute(
            select(deadline_table).where(deadline_table.c.studentId == student_id)
        )
    ).mappings()
    return {
        "student": {
            "id": student.id,
            "name": f"{student.firstName} {student.lastName}",
            "risk_level": student.riskLevel,
            "journey_stage": student.journeyStage,
            "next_action_json": student.nextActionJson,
        },
        "open_tasks": [
            {"id": item.id, "title": item.title, "priority": item.priority}
            for item in tasks
        ],
        "documents": [
            {"id": item.id, "name": item.name, "status": item.status}
            for item in documents
        ],
        "applications": [
            {
                "id": item.id,
                "status": item.status,
                "readiness_percent": item.readinessPercent,
                "risk_level": item.riskLevel,
            }
            for item in applications
        ],
        "deadlines": [
            {"id": item.id, "title": item.title, "date": item.date.isoformat()}
            for item in deadlines
        ],
    }


async def appointment_list_slots(
    db: AsyncSession, arguments: dict[str, Any]
) -> dict[str, Any]:
    curator_id = _required(arguments, "curator_id")
    timezone_name = str(arguments.get("timezone") or "Europe/Rome")
    timezone = ZoneInfo(timezone_name)
    start_date = datetime.now(timezone).date() + timedelta(days=1)
    days = max(1, min(int(arguments.get("days") or 14), 30))
    range_start = datetime.combine(start_date, time(0, 0), timezone).astimezone(UTC)
    range_end = range_start + timedelta(days=days + 1)
    appointments = [
        dict(row)
        for row in (
            await db.execute(
                select(appointment_table).where(
                    appointment_table.c.assignedCuratorId == curator_id,
                    appointment_table.c.status.in_(["PENDING", "CONFIRMED"]),
                    appointment_table.c.startsAt < range_end,
                    appointment_table.c.endsAt > range_start,
                )
            )
        ).mappings()
    ]
    slots: list[dict[str, str]] = []
    for day_offset in range(days):
        day = start_date + timedelta(days=day_offset)
        if day.weekday() >= 5:
            continue
        for hour in range(9, 17):
            starts = datetime.combine(day, time(hour, 0), timezone).astimezone(UTC)
            ends = starts + timedelta(minutes=45)
            overlaps = any(
                _aware(appointment["startsAt"]) < ends
                and _aware(appointment["endsAt"]) > starts
                for appointment in appointments
            )
            if not overlaps:
                slots.append(
                    {
                        "starts_at": starts.isoformat(),
                        "ends_at": ends.isoformat(),
                        "timezone": timezone_name,
                    }
                )
            if len(slots) >= 20:
                return {"slots": slots}
    return {"slots": slots}


async def appointment_create(
    db: AsyncSession, arguments: dict[str, Any]
) -> dict[str, Any]:
    curator_id = _required(arguments, "curator_id")
    starts_at = datetime.fromisoformat(_required(arguments, "starts_at"))
    ends_at = datetime.fromisoformat(_required(arguments, "ends_at"))
    lead_id = str(arguments.get("lead_id") or "") or None
    student_id = str(arguments.get("student_id") or "") or None
    conversation_id = str(arguments.get("conversation_id") or "") or None
    title = str(arguments.get("title") or "Консультация")
    timezone = str(arguments.get("timezone") or "Europe/Rome")
    participants = arguments.get("participants")
    return await _run_agent_command(
        db,
        arguments=arguments,
        operation="appointment.create",
        payload={
            "curator_id": curator_id,
            "starts_at": starts_at.isoformat(),
            "ends_at": ends_at.isoformat(),
            "timezone": timezone,
            "lead_id": lead_id,
            "student_id": student_id,
            "conversation_id": conversation_id,
            "title": title,
            "participants": participants,
        },
        handler=lambda context: create_appointment_command(
            db,
            context=context,
            curator_id=curator_id,
            starts_at=starts_at,
            ends_at=ends_at,
            timezone=timezone,
            lead_id=lead_id,
            student_id=student_id,
            conversation_id=conversation_id,
            title=title,
            participants=participants,
        ),
    )


async def onboarding_prepare(
    db: AsyncSession, arguments: dict[str, Any]
) -> dict[str, Any]:
    lead_id = _required(arguments, "lead_id")
    approval_id = _required(arguments, "approval_id")
    return await _run_agent_command(
        db,
        arguments=arguments,
        operation="onboarding.prepare",
        payload={"lead_id": lead_id, "approval_id": approval_id},
        handler=lambda context: prepare_onboarding_command(
            db, context=context, lead_id=lead_id, approval_id=approval_id
        ),
    )


async def document_list_gaps(
    db: AsyncSession, arguments: dict[str, Any]
) -> dict[str, Any]:
    student_id = _required(arguments, "student_id")
    rows = (
        await db.execute(
            select(document_table).where(
                document_table.c.studentId == student_id,
                document_table.c.status.in_(
                    ["MISSING", "REQUESTED", "NEEDS_CHANGES", "EXPIRED"]
                ),
            )
        )
    ).mappings()
    return {
        "student_id": student_id,
        "documents": [
            {
                "id": row.id,
                "name": row.name,
                "category": row.category,
                "status": row.status,
                "requested_at": (
                    row.requestedAt.isoformat() if row.requestedAt else None
                ),
            }
            for row in rows
        ],
    }


async def document_request(
    db: AsyncSession, arguments: dict[str, Any]
) -> dict[str, Any]:
    document_id = _required(arguments, "document_id")

    async def handler(context):
        from fastapi import HTTPException

        try:
            return await request_document_command(
                db, context=context, document_id=document_id
            )
        except HTTPException as error:
            raise ValueError(str(error.detail)) from error

    response = await _run_agent_command(
        db,
        arguments=arguments,
        operation="document.request",
        payload={"document_id": document_id},
        handler=handler,
    )
    return {
        "document_id": response.get("id") or document_id,
        "status": response.get("status", "REQUESTED"),
    }


async def scheduling_request(
    db: AsyncSession, arguments: dict[str, Any]
) -> dict[str, Any]:
    conversation_id = _required(arguments, "conversation_id")
    return await _run_agent_command(
        db,
        arguments=arguments,
        operation="scheduling.request",
        payload={"conversation_id": conversation_id},
        handler=lambda context: request_scheduling_command(
            db, context=context, conversation_id=conversation_id
        ),
    )


def _object_schema(required: list[str], properties: dict[str, Any]) -> dict[str, Any]:
    return {
        "type": "object",
        "additionalProperties": False,
        "required": required,
        "properties": properties,
    }


register_tool(
    ToolDefinition(
        "lead.get",
        "Read a lead profile and qualification state.",
        _object_schema(["lead_id"], {"lead_id": {"type": "string"}}),
        "leads:read",
        "READ",
        lead_get,
    )
)
register_tool(
    ToolDefinition(
        "lead.update_qualification",
        "Update allow-listed lead qualification fields.",
        _object_schema(
            ["lead_id", "fields", "idempotency_key"],
            {
                "lead_id": {"type": "string"},
                "fields": {"type": "object"},
                "idempotency_key": {"type": "string"},
            },
        ),
        "leads:write",
        "REVERSIBLE_WRITE",
        lead_update_qualification,
    )
)
register_tool(
    ToolDefinition(
        "conversation.get_recent",
        "Read recent normalized conversation messages.",
        _object_schema(
            ["conversation_id"],
            {
                "conversation_id": {"type": "string"},
                "limit": {"type": "integer", "minimum": 1, "maximum": 50},
            },
        ),
        "cases:read",
        "READ",
        conversation_recent,
    )
)
register_tool(
    ToolDefinition(
        "message.propose",
        "Create an outbound draft; this does not send it.",
        _object_schema(
            ["conversation_id", "text", "idempotency_key", "agent_key"],
            {
                "conversation_id": {"type": "string"},
                "text": {"type": "string", "minLength": 1, "maxLength": 5000},
                "idempotency_key": {"type": "string"},
                "agent_key": {"type": "string"},
            },
        ),
        "messages:draft",
        "REVERSIBLE_WRITE",
        message_propose,
    )
)
register_tool(
    ToolDefinition(
        "message.request_send",
        "Run policy checks and queue or request approval for a draft.",
        _object_schema(
            ["message_id", "idempotency_key"],
            {
                "message_id": {"type": "string"},
                "idempotency_key": {"type": "string"},
                "template_key": {"type": "string"},
            },
        ),
        "messages:send",
        "EXTERNAL_SEND",
        message_request_send,
    )
)
register_tool(
    ToolDefinition(
        "task.create",
        "Create an idempotent task for a student or staff member.",
        _object_schema(
            ["student_id", "title", "idempotency_key", "agent_key"],
            {
                "student_id": {"type": "string"},
                "title": {"type": "string"},
                "description": {"type": "string"},
                "priority": {"type": "string"},
                "assignee_id": {"type": "string"},
                "application_id": {"type": "string"},
                "is_student_facing": {"type": "boolean"},
                "idempotency_key": {"type": "string"},
                "agent_key": {"type": "string"},
            },
        ),
        "tasks:create",
        "REVERSIBLE_WRITE",
        task_create,
    )
)
register_tool(
    ToolDefinition(
        "case.get_snapshot",
        "Read the canonical operational state of a student case.",
        _object_schema(["student_id"], {"student_id": {"type": "string"}}),
        "cases:read",
        "READ",
        case_snapshot,
    )
)
register_tool(
    ToolDefinition(
        "appointment.list_slots",
        "List deterministic available consultation slots for a curator.",
        _object_schema(
            ["curator_id"],
            {
                "curator_id": {"type": "string"},
                "timezone": {"type": "string"},
                "days": {"type": "integer", "minimum": 1, "maximum": 30},
            },
        ),
        "cases:read",
        "READ",
        appointment_list_slots,
    )
)
register_tool(
    ToolDefinition(
        "appointment.create",
        "Reserve an available consultation slot and queue calendar synchronization.",
        _object_schema(
            ["curator_id", "starts_at", "ends_at", "idempotency_key"],
            {
                "curator_id": {"type": "string"},
                "starts_at": {"type": "string", "format": "date-time"},
                "ends_at": {"type": "string", "format": "date-time"},
                "timezone": {"type": "string"},
                "lead_id": {"type": "string"},
                "student_id": {"type": "string"},
                "conversation_id": {"type": "string"},
                "title": {"type": "string"},
                "participants": {"type": "array", "items": {"type": "object"}},
                "idempotency_key": {"type": "string"},
            },
        ),
        "appointments:write",
        "EXTERNAL_SEND",
        appointment_create,
    )
)
register_tool(
    ToolDefinition(
        "onboarding.prepare",
        "Convert an approved, qualified lead into one student and create starter work.",
        _object_schema(
            ["lead_id", "approval_id", "idempotency_key"],
            {
                "lead_id": {"type": "string"},
                "approval_id": {"type": "string"},
                "idempotency_key": {"type": "string"},
            },
        ),
        "leads:write",
        "IRREVERSIBLE",
        onboarding_prepare,
    )
)
register_tool(
    ToolDefinition(
        "document.list_gaps",
        "List missing, requested, expired, or correction-required documents.",
        _object_schema(["student_id"], {"student_id": {"type": "string"}}),
        "documents:read",
        "READ",
        document_list_gaps,
    )
)
register_tool(
    ToolDefinition(
        "document.request",
        "Request an existing document record from a student.",
        _object_schema(
            ["document_id", "idempotency_key"],
            {
                "document_id": {"type": "string"},
                "idempotency_key": {"type": "string"},
            },
        ),
        "documents:request",
        "REVERSIBLE_WRITE",
        document_request,
    )
)
register_tool(
    ToolDefinition(
        "scheduling.request",
        "Hand a conversation to the scheduling specialist.",
        _object_schema(
            ["conversation_id", "idempotency_key"],
            {
                "conversation_id": {"type": "string"},
                "idempotency_key": {"type": "string"},
            },
        ),
        "appointments:write",
        "REVERSIBLE_WRITE",
        scheduling_request,
    )
)
