from datetime import UTC, datetime
from uuid import uuid4

from fastapi import HTTPException
from sqlalchemy import insert, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.tables import (
    agent_definition_table,
    agent_run_table,
    approval_request_table,
    automation_setting_table,
    conversation_message_table,
    conversation_table,
    lead_table,
    outbox_event_table,
)
from app.events.records import append_audit, append_outbox
from app.services.commands.base import CommandContext, CommandResult


async def request_lead_conversion_command(
    db: AsyncSession,
    *,
    context: CommandContext,
    lead_id: str,
) -> CommandResult:
    lead = (
        await db.execute(select(lead_table).where(lead_table.c.id == lead_id))
    ).mappings().first()
    if lead is None:
        raise HTTPException(status_code=404, detail="Lead not found")
    if lead.convertedStudentId:
        return CommandResult(
            response={
                "status": "ALREADY_CONVERTED",
                "student_id": lead.convertedStudentId,
            },
            entity_type="Lead",
            entity_id=lead_id,
        )
    existing = (
        await db.execute(
            select(approval_request_table.c.id).where(
                approval_request_table.c.action == "lead.convert",
                approval_request_table.c.subjectType == "Lead",
                approval_request_table.c.subjectId == lead_id,
                approval_request_table.c.status == "PENDING",
            )
        )
    ).scalar_one_or_none()
    if existing:
        return CommandResult(
            response={"status": "PENDING", "approval_id": existing},
            entity_type="ApprovalRequest",
            entity_id=existing,
        )
    now = datetime.now(UTC)
    approval_id = uuid4().hex
    await db.execute(
        insert(approval_request_table).values(
            id=approval_id,
            action="lead.convert",
            riskClass="HIGH",
            status="PENDING",
            subjectType="Lead",
            subjectId=lead_id,
            proposedJson={
                "lead_id": lead_id,
                "email": lead.email,
                "qualification": lead.qualificationJson or {},
            },
            createdAt=now,
            updatedAt=now,
        )
    )
    await append_audit(
        db,
        actor_type=context.actor_type,
        actor_id=context.actor_id,
        user_id=context.actor_id if context.actor_type == "USER" else None,
        action="lead.conversion.request",
        entity_type="Lead",
        entity_id=lead_id,
        correlation_id=context.correlation_id,
        after={"approvalId": approval_id},
        now=now,
    )
    return CommandResult(
        response={"status": "PENDING", "approval_id": approval_id},
        http_status=201,
        entity_type="ApprovalRequest",
        entity_id=approval_id,
    )


async def decide_approval_command(
    db: AsyncSession,
    *,
    context: CommandContext,
    approval_id: str,
    decision: str,
    note: str | None = None,
) -> CommandResult:
    now = datetime.now(UTC)
    approval = (
        await db.execute(
            select(approval_request_table)
            .where(approval_request_table.c.id == approval_id)
            .with_for_update()
        )
    ).mappings().first()
    if approval is None:
        raise HTTPException(status_code=404, detail="Approval not found")
    if approval.status != "PENDING":
        return CommandResult(
            response={"id": approval_id, "status": approval.status},
            entity_type="ApprovalRequest",
            entity_id=approval_id,
        )
    await db.execute(
        update(approval_request_table)
        .where(approval_request_table.c.id == approval_id)
        .values(
            status=decision,
            decidedById=context.actor_id if context.actor_type == "USER" else None,
            decisionNote=note,
            decidedAt=now,
            updatedAt=now,
        )
    )
    if approval.action == "message.send":
        delivery_status = "QUEUED" if decision == "APPROVED" else "BLOCKED"
        await db.execute(
            update(conversation_message_table)
            .where(conversation_message_table.c.id == approval.subjectId)
            .values(
                policyStatus=decision,
                deliveryStatus=delivery_status,
                updatedAt=now,
            )
        )
        if decision == "APPROVED":
            await append_outbox(
                db,
                aggregate_type="ConversationMessage",
                aggregate_id=approval.subjectId,
                event_type="message.send.requested.v1",
                payload={"message_id": approval.subjectId},
                idempotency_key=f"approval:{approval_id}:message-send",
                now=now,
            )
    elif approval.action == "lead.convert" and decision == "APPROVED":
        await append_outbox(
            db,
            aggregate_type="Lead",
            aggregate_id=approval.subjectId,
            event_type="lead.conversion.approved.v1",
            payload={"lead_id": approval.subjectId, "approval_id": approval_id},
            idempotency_key=f"approval:{approval_id}:lead-convert",
            now=now,
        )
    await append_audit(
        db,
        actor_type=context.actor_type,
        actor_id=context.actor_id,
        user_id=context.actor_id if context.actor_type == "USER" else None,
        action="approval.decide",
        entity_type="ApprovalRequest",
        entity_id=approval_id,
        correlation_id=context.correlation_id,
        before={"status": "PENDING"},
        after={"status": decision},
        now=now,
    )
    return CommandResult(
        response={"id": approval_id, "status": decision},
        entity_type="ApprovalRequest",
        entity_id=approval_id,
    )


async def retry_agent_run_command(
    db: AsyncSession,
    *,
    context: CommandContext,
    run_id: str,
) -> CommandResult:
    run = (
        await db.execute(select(agent_run_table).where(agent_run_table.c.id == run_id))
    ).mappings().first()
    if run is None:
        raise HTTPException(status_code=404, detail="Agent run not found")
    if run.status in {"STARTING", "QUEUED", "RUNNING"}:
        raise HTTPException(status_code=409, detail="Agent run is still active")
    input_data = run.inputJson or {}
    event_type = input_data.get("event_type")
    payload = input_data.get("payload")
    if not event_type or not isinstance(payload, dict):
        raise HTTPException(status_code=409, detail="Agent run cannot be replayed")
    event_id = await append_outbox(
        db,
        aggregate_type=run.subjectType,
        aggregate_id=run.subjectId,
        event_type=event_type,
        payload=payload,
        idempotency_key=f"agent-run-retry:{run_id}:{context.idempotency_key}",
    )
    await append_audit(
        db,
        actor_type=context.actor_type,
        actor_id=context.actor_id,
        user_id=context.actor_id if context.actor_type == "USER" else None,
        action="agent_run.retry",
        entity_type="AgentRun",
        entity_id=run_id,
        correlation_id=context.correlation_id,
        after={"outboxEventId": event_id},
    )
    return CommandResult(
        response={"event_id": event_id, "status": "QUEUED"},
        entity_type="AgentRun",
        entity_id=run_id,
    )


async def cancel_agent_run_command(
    db: AsyncSession,
    *,
    context: CommandContext,
    run_id: str,
) -> CommandResult:
    run = (
        await db.execute(select(agent_run_table).where(agent_run_table.c.id == run_id))
    ).mappings().first()
    if run is None:
        raise HTTPException(status_code=404, detail="Agent run not found")
    if run.status in {"COMPLETED", "FAILED", "CANCELLED", "TIMED_OUT"}:
        return CommandResult(
            response={
                "id": run_id,
                "status": run.status,
                "hermes_run_id": None,
            },
            entity_type="AgentRun",
            entity_id=run_id,
        )
    now = datetime.now(UTC)
    await db.execute(
        update(agent_run_table)
        .where(agent_run_table.c.id == run_id)
        .values(status="CANCELLED", completedAt=now, updatedAt=now)
    )
    hermes_run_id = run.hermesRunId
    if hermes_run_id:
        await append_outbox(
            db,
            aggregate_type="AgentRun",
            aggregate_id=run_id,
            event_type="agent_run.cancel.requested.v1",
            payload={"agent_run_id": run_id, "hermes_run_id": hermes_run_id},
            idempotency_key=f"agent-run-cancel:{run_id}:{context.idempotency_key}",
            now=now,
        )
    await append_audit(
        db,
        actor_type=context.actor_type,
        actor_id=context.actor_id,
        user_id=context.actor_id if context.actor_type == "USER" else None,
        action="agent_run.cancel",
        entity_type="AgentRun",
        entity_id=run_id,
        correlation_id=context.correlation_id,
        after={"status": "CANCELLED"},
        now=now,
    )
    return CommandResult(
        response={
            "id": run_id,
            "status": "CANCELLED",
            "hermes_run_id": hermes_run_id,
        },
        entity_type="AgentRun",
        entity_id=run_id,
    )


async def set_global_automation_command(
    db: AsyncSession,
    *,
    context: CommandContext,
    enabled: bool,
    reason: str | None = None,
) -> CommandResult:
    now = datetime.now(UTC)
    existing = (
        await db.execute(
            select(automation_setting_table.c.key).where(
                automation_setting_table.c.key == "global_enabled"
            )
        )
    ).scalar_one_or_none()
    values = {
        "valueJson": {
            "enabled": enabled,
            "reason": reason,
            "changed_by": context.actor_id,
        },
        "description": "Global automation kill switch",
        "updatedAt": now,
    }
    if existing:
        await db.execute(
            update(automation_setting_table)
            .where(automation_setting_table.c.key == "global_enabled")
            .values(**values)
        )
    else:
        await db.execute(
            insert(automation_setting_table).values(key="global_enabled", **values)
        )
    await append_audit(
        db,
        actor_type=context.actor_type,
        actor_id=context.actor_id,
        user_id=context.actor_id if context.actor_type == "USER" else None,
        action="automation.global.set",
        entity_type="AutomationSetting",
        entity_id="global_enabled",
        correlation_id=context.correlation_id,
        after={"enabled": enabled, "reason": reason},
        now=now,
    )
    return CommandResult(
        response={"enabled": enabled},
        entity_type="AutomationSetting",
        entity_id="global_enabled",
    )


async def replay_dead_outbox_command(
    db: AsyncSession,
    *,
    context: CommandContext,
    event_id: str,
) -> CommandResult:
    now = datetime.now(UTC)
    result = await db.execute(
        update(outbox_event_table)
        .where(
            outbox_event_table.c.id == event_id,
            outbox_event_table.c.status == "DEAD",
        )
        .values(
            status="PENDING",
            attempts=0,
            nextAttemptAt=now,
            lockedBy=None,
            lockedAt=None,
            leaseToken=None,
            leaseExpiresAt=None,
            lastError=None,
            updatedAt=now,
        )
    )
    if result.rowcount == 0:
        raise HTTPException(status_code=404, detail="Dead-letter event not found")
    await append_audit(
        db,
        actor_type=context.actor_type,
        actor_id=context.actor_id,
        user_id=context.actor_id if context.actor_type == "USER" else None,
        action="outbox.dead.replay",
        entity_type="OutboxEvent",
        entity_id=event_id,
        correlation_id=context.correlation_id,
        after={"status": "PENDING"},
        now=now,
    )
    return CommandResult(
        response={"id": event_id, "status": "PENDING"},
        entity_type="OutboxEvent",
        entity_id=event_id,
    )


async def update_agent_definition_command(
    db: AsyncSession,
    *,
    context: CommandContext,
    agent_key: str,
    enabled: bool | None = None,
    autonomy_level: str | None = None,
    max_iterations: int | None = None,
    timeout_seconds: int | None = None,
) -> CommandResult:
    values = {
        key: value
        for key, value in {
            "enabled": enabled,
            "autonomyLevel": autonomy_level,
            "maxIterations": max_iterations,
            "timeoutSeconds": timeout_seconds,
        }.items()
        if value is not None
    }
    if not values:
        raise HTTPException(status_code=422, detail="No changes requested")
    result = await db.execute(
        update(agent_definition_table)
        .where(agent_definition_table.c.key == agent_key)
        .values(**values)
    )
    if result.rowcount == 0:
        raise HTTPException(status_code=404, detail="Agent definition not found")
    await append_audit(
        db,
        actor_type=context.actor_type,
        actor_id=context.actor_id,
        user_id=context.actor_id if context.actor_type == "USER" else None,
        action="agent_definition.update",
        entity_type="AgentDefinition",
        entity_id=agent_key,
        correlation_id=context.correlation_id,
        after=values,
    )
    return CommandResult(
        response={"key": agent_key, **values},
        entity_type="AgentDefinition",
        entity_id=agent_key,
    )


async def pause_conversation_command(
    db: AsyncSession,
    *,
    context: CommandContext,
    conversation_id: str,
    paused: bool,
    reason: str | None = None,
) -> CommandResult:
    now = datetime.now(UTC)
    result = await db.execute(
        update(conversation_table)
        .where(conversation_table.c.id == conversation_id)
        .values(
            automationPausedAt=now if paused else None,
            automationPauseReason=reason if paused else None,
            updatedAt=now,
        )
    )
    if result.rowcount == 0:
        raise HTTPException(status_code=404, detail="Conversation not found")
    await append_audit(
        db,
        actor_type=context.actor_type,
        actor_id=context.actor_id,
        user_id=context.actor_id if context.actor_type == "USER" else None,
        action="conversation.pause",
        entity_type="Conversation",
        entity_id=conversation_id,
        correlation_id=context.correlation_id,
        after={"paused": paused, "reason": reason},
        now=now,
    )
    return CommandResult(
        response={"conversation_id": conversation_id, "paused": paused},
        entity_type="Conversation",
        entity_id=conversation_id,
    )


async def request_case_review_command(
    db: AsyncSession,
    *,
    context: CommandContext,
    student_id: str,
) -> CommandResult:
    event_id = await append_outbox(
        db,
        aggregate_type="Student",
        aggregate_id=student_id,
        event_type="case.review.requested.v1",
        payload={"student_id": student_id},
        idempotency_key=f"case-review:{student_id}:{context.idempotency_key}",
    )
    await append_audit(
        db,
        actor_type=context.actor_type,
        actor_id=context.actor_id,
        user_id=context.actor_id if context.actor_type == "USER" else None,
        action="case.review.request",
        entity_type="Student",
        entity_id=student_id,
        correlation_id=context.correlation_id,
        after={"eventId": event_id},
    )
    return CommandResult(
        response={"event_id": event_id, "status": "QUEUED"},
        entity_type="Student",
        entity_id=student_id,
    )
