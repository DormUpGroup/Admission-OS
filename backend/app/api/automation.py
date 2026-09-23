from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import Actor, StaffActor
from app.db.session import get_db_session
from app.db.tables import (
    agent_definition_table,
    agent_run_table,
    approval_request_table,
    conversation_message_table,
    conversation_table,
    lead_table,
    outbox_event_table,
)
from app.orchestration.registry import sync_agent_definitions
from app.orchestration.settings import automation_is_enabled
from app.schemas.automation import (
    AgentDefinitionUpdateRequest,
    ApprovalDecisionRequest,
    AutomationOverview,
    AutomationToggleRequest,
    ConversationPauseRequest,
)
from app.services.commands.automation import (
    cancel_agent_run_command,
    decide_approval_command,
    pause_conversation_command,
    replay_dead_outbox_command,
    request_case_review_command,
    request_lead_conversion_command,
    retry_agent_run_command,
    set_global_automation_command,
    update_agent_definition_command,
)
from app.services.commands.base import (
    execute_command,
    require_idempotency_key,
    user_context,
)
from app.services.commands.messages import (
    confirm_message_delivery_command,
    resend_message_safe_command,
)

router = APIRouter(prefix="/automation", tags=["automation"])
DbSession = Annotated[AsyncSession, Depends(get_db_session)]


def require_admin(actor: Actor) -> None:
    if actor.role != "ADMIN":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, detail="Admin access required"
        )


@router.get("/overview", response_model=AutomationOverview)
async def automation_overview(actor: StaffActor, db: DbSession) -> AutomationOverview:
    require_admin(actor)
    await sync_agent_definitions(db)
    leads = (
        await db.execute(
            select(lead_table.c.status, func.count()).group_by(lead_table.c.status)
        )
    ).all()

    async def count_where(table, *where) -> int:
        return int(
            (
                await db.execute(select(func.count()).select_from(table).where(*where))
            ).scalar_one()
        )

    agents = [
        {
            "key": row.key,
            "version": row.version,
            "enabled": row.enabled,
            "autonomy_level": row.autonomyLevel,
            "max_iterations": row.maxIterations,
            "timeout_seconds": row.timeoutSeconds,
        }
        for row in (
            await db.execute(
                select(agent_definition_table).order_by(agent_definition_table.c.key)
            )
        ).mappings()
    ]
    await db.commit()
    return AutomationOverview(
        automation_enabled=await automation_is_enabled(db),
        leads_by_status={str(key): int(value) for key, value in leads},
        pending_approvals=await count_where(
            approval_request_table, approval_request_table.c.status == "PENDING"
        ),
        active_runs=await count_where(
            agent_run_table,
            agent_run_table.c.status.in_(["STARTING", "QUEUED", "RUNNING"]),
        ),
        pending_outbox=await count_where(
            outbox_event_table,
            outbox_event_table.c.status.in_(["PENDING", "PROCESSING"]),
        ),
        dead_outbox=await count_where(
            outbox_event_table, outbox_event_table.c.status == "DEAD"
        ),
        agents=agents,
    )


@router.get("/leads")
async def list_leads(
    _: StaffActor,
    db: DbSession,
    lead_status: Annotated[str | None, Query(alias="status")] = None,
) -> list[dict[str, Any]]:
    statement = select(lead_table).order_by(lead_table.c.createdAt.desc()).limit(200)
    if lead_status:
        statement = statement.where(lead_table.c.status == lead_status)
    return [
        {
            "id": row.id,
            "name": " ".join(
                part for part in (row.firstName, row.lastName) if part
            )
            or "Без имени",
            "email": row.email,
            "phone": row.phone,
            "status": row.status,
            "source": row.source,
            "consent_status": row.consentStatus,
            "assigned_curator_id": row.assignedCuratorId,
            "created_at": row.createdAt,
        }
        for row in (await db.execute(statement)).mappings()
    ]


@router.get("/leads/{lead_id}")
async def get_lead(_: StaffActor, db: DbSession, lead_id: str) -> dict[str, Any]:
    lead = (
        await db.execute(select(lead_table).where(lead_table.c.id == lead_id))
    ).mappings().first()
    if lead is None:
        raise HTTPException(status_code=404, detail="Lead not found")
    conversations = [
        dict(row)
        for row in (
            await db.execute(
                select(conversation_table)
                .where(conversation_table.c.leadId == lead_id)
                .order_by(conversation_table.c.createdAt)
            )
        ).mappings()
    ]
    conversation_ids = [row["id"] for row in conversations]
    messages = []
    if conversation_ids:
        messages = [
            {
                "id": row.id,
                "conversation_id": row.conversationId,
                "direction": row.direction,
                "sender_type": row.senderType,
                "body": row.body,
                "delivery_status": row.deliveryStatus,
                "policy_status": row.policyStatus,
                "created_at": row.createdAt,
            }
            for row in (
                await db.execute(
                    select(conversation_message_table)
                    .where(
                        conversation_message_table.c.conversationId.in_(
                            conversation_ids
                        )
                    )
                    .order_by(conversation_message_table.c.createdAt)
                )
            ).mappings()
        ]
    return {
        "lead": {
            "id": lead.id,
            "first_name": lead.firstName,
            "last_name": lead.lastName,
            "email": lead.email,
            "phone": lead.phone,
            "status": lead.status,
            "source": lead.source,
            "locale": lead.locale,
            "consent_status": lead.consentStatus,
            "qualification": lead.qualificationJson or {},
            "converted_student_id": lead.convertedStudentId,
        },
        "conversations": conversations,
        "messages": messages,
    }


@router.get("/approvals")
async def list_approvals(
    _: StaffActor,
    db: DbSession,
    approval_status: Annotated[str, Query(alias="status")] = "PENDING",
) -> list[dict[str, Any]]:
    return [
        {
            "id": row.id,
            "action": row.action,
            "risk_class": row.riskClass,
            "status": row.status,
            "subject_type": row.subjectType,
            "subject_id": row.subjectId,
            "proposed": row.proposedJson,
            "created_at": row.createdAt,
            "expires_at": row.expiresAt,
        }
        for row in (
            await db.execute(
                select(approval_request_table)
                .where(approval_request_table.c.status == approval_status)
                .order_by(approval_request_table.c.createdAt)
            )
        ).mappings()
    ]


@router.post("/leads/{lead_id}/request-conversion")
async def request_lead_conversion(
    actor: StaffActor,
    db: DbSession,
    lead_id: str,
    idempotency_key: Annotated[str, Depends(require_idempotency_key)],
) -> dict[str, Any]:
    await db.rollback()
    async with db.begin():
        executed = await execute_command(
            db,
            context=user_context(
                user_id=actor.id,
                operation="lead.conversion.request",
                idempotency_key=idempotency_key,
            ),
            payload={"lead_id": lead_id},
            handler=lambda context: request_lead_conversion_command(
                db, context=context, lead_id=lead_id
            ),
        )
    return executed.result.response


@router.post("/approvals/{approval_id}/decision")
async def decide_approval(
    actor: StaffActor,
    db: DbSession,
    approval_id: str,
    request: ApprovalDecisionRequest,
    idempotency_key: Annotated[str, Depends(require_idempotency_key)],
) -> dict[str, Any]:
    await db.rollback()
    async with db.begin():
        executed = await execute_command(
            db,
            context=user_context(
                user_id=actor.id,
                operation="approval.decide",
                idempotency_key=idempotency_key,
            ),
            payload={
                "approval_id": approval_id,
                "decision": request.decision,
                "note": request.note,
            },
            handler=lambda context: decide_approval_command(
                db,
                context=context,
                approval_id=approval_id,
                decision=request.decision,
                note=request.note,
            ),
        )
    return executed.result.response


@router.get("/runs")
async def list_agent_runs(
    _: StaffActor, db: DbSession, limit: Annotated[int, Query(ge=1, le=200)] = 100
) -> list[dict[str, Any]]:
    return [
        {
            "id": row.id,
            "agent_key": row.agentKey,
            "status": row.status,
            "subject_type": row.subjectType,
            "subject_id": row.subjectId,
            "hermes_run_id": row.hermesRunId,
            "error_code": row.errorCode,
            "error_message": row.errorMessage,
            "started_at": row.startedAt,
            "completed_at": row.completedAt,
            "created_at": row.createdAt,
        }
        for row in (
            await db.execute(
                select(agent_run_table)
                .order_by(agent_run_table.c.createdAt.desc())
                .limit(limit)
            )
        ).mappings()
    ]


@router.post("/runs/{run_id}/retry")
async def retry_agent_run(
    actor: StaffActor,
    db: DbSession,
    run_id: str,
    idempotency_key: Annotated[str, Depends(require_idempotency_key)],
) -> dict[str, Any]:
    await db.rollback()
    async with db.begin():
        executed = await execute_command(
            db,
            context=user_context(
                user_id=actor.id,
                operation="agent_run.retry",
                idempotency_key=idempotency_key,
            ),
            payload={"run_id": run_id},
            handler=lambda context: retry_agent_run_command(
                db, context=context, run_id=run_id
            ),
        )
    return executed.result.response


@router.post("/runs/{run_id}/cancel")
async def cancel_agent_run(
    actor: StaffActor,
    db: DbSession,
    run_id: str,
    idempotency_key: Annotated[str, Depends(require_idempotency_key)],
) -> dict[str, Any]:
    await db.rollback()
    async with db.begin():
        executed = await execute_command(
            db,
            context=user_context(
                user_id=actor.id,
                operation="agent_run.cancel",
                idempotency_key=idempotency_key,
            ),
            payload={"run_id": run_id},
            handler=lambda context: cancel_agent_run_command(
                db, context=context, run_id=run_id
            ),
        )
    response = dict(executed.result.response)
    response.pop("hermes_run_id", None)
    return response


@router.put("/settings/global")
async def set_global_automation(
    actor: StaffActor,
    db: DbSession,
    request: AutomationToggleRequest,
    idempotency_key: Annotated[str, Depends(require_idempotency_key)],
) -> dict[str, Any]:
    require_admin(actor)
    await db.rollback()
    async with db.begin():
        executed = await execute_command(
            db,
            context=user_context(
                user_id=actor.id,
                operation="automation.global.set",
                idempotency_key=idempotency_key,
            ),
            payload={"enabled": request.enabled, "reason": request.reason},
            handler=lambda context: set_global_automation_command(
                db,
                context=context,
                enabled=request.enabled,
                reason=request.reason,
            ),
        )
    return executed.result.response


@router.get("/outbox/dead")
async def list_dead_outbox(
    actor: StaffActor,
    db: DbSession,
    limit: Annotated[int, Query(ge=1, le=200)] = 100,
) -> list[dict[str, Any]]:
    require_admin(actor)
    return [
        {
            "id": row.id,
            "event_type": row.eventType,
            "aggregate_type": row.aggregateType,
            "aggregate_id": row.aggregateId,
            "attempts": row.attempts,
            "last_error": row.lastError,
            "created_at": row.createdAt,
        }
        for row in (
            await db.execute(
                select(outbox_event_table)
                .where(outbox_event_table.c.status == "DEAD")
                .order_by(outbox_event_table.c.createdAt.desc())
                .limit(limit)
            )
        ).mappings()
    ]


@router.post("/outbox/{event_id}/replay")
async def replay_dead_outbox(
    actor: StaffActor,
    db: DbSession,
    event_id: str,
    idempotency_key: Annotated[str, Depends(require_idempotency_key)],
) -> dict[str, Any]:
    require_admin(actor)
    await db.rollback()
    async with db.begin():
        executed = await execute_command(
            db,
            context=user_context(
                user_id=actor.id,
                operation="outbox.dead.replay",
                idempotency_key=idempotency_key,
            ),
            payload={"event_id": event_id},
            handler=lambda context: replay_dead_outbox_command(
                db, context=context, event_id=event_id
            ),
        )
    return executed.result.response


@router.put("/agents/{agent_key}")
async def update_agent_definition(
    actor: StaffActor,
    db: DbSession,
    agent_key: str,
    request: AgentDefinitionUpdateRequest,
    idempotency_key: Annotated[str, Depends(require_idempotency_key)],
) -> dict[str, Any]:
    require_admin(actor)
    await db.rollback()
    async with db.begin():
        executed = await execute_command(
            db,
            context=user_context(
                user_id=actor.id,
                operation="agent_definition.update",
                idempotency_key=idempotency_key,
            ),
            payload={
                "agent_key": agent_key,
                "enabled": request.enabled,
                "autonomy_level": request.autonomy_level,
                "max_iterations": request.max_iterations,
                "timeout_seconds": request.timeout_seconds,
            },
            handler=lambda context: update_agent_definition_command(
                db,
                context=context,
                agent_key=agent_key,
                enabled=request.enabled,
                autonomy_level=request.autonomy_level,
                max_iterations=request.max_iterations,
                timeout_seconds=request.timeout_seconds,
            ),
        )
    return executed.result.response


@router.put("/conversations/{conversation_id}/pause")
async def pause_conversation(
    actor: StaffActor,
    db: DbSession,
    conversation_id: str,
    request: ConversationPauseRequest,
    idempotency_key: Annotated[str, Depends(require_idempotency_key)],
) -> dict[str, Any]:
    await db.rollback()
    async with db.begin():
        executed = await execute_command(
            db,
            context=user_context(
                user_id=actor.id,
                operation="conversation.pause",
                idempotency_key=idempotency_key,
            ),
            payload={
                "conversation_id": conversation_id,
                "paused": request.paused,
                "reason": request.reason,
            },
            handler=lambda context: pause_conversation_command(
                db,
                context=context,
                conversation_id=conversation_id,
                paused=request.paused,
                reason=request.reason,
            ),
        )
    return executed.result.response


@router.post("/cases/{student_id}/review")
async def request_case_review(
    actor: StaffActor,
    db: DbSession,
    student_id: str,
    idempotency_key: Annotated[str, Depends(require_idempotency_key)],
) -> dict[str, Any]:
    await db.rollback()
    async with db.begin():
        executed = await execute_command(
            db,
            context=user_context(
                user_id=actor.id,
                operation="case.review.request",
                idempotency_key=idempotency_key,
            ),
            payload={"student_id": student_id},
            handler=lambda context: request_case_review_command(
                db, context=context, student_id=student_id
            ),
        )
    return executed.result.response


@router.post("/messages/{message_id}/confirm-delivery")
async def confirm_message_delivery(
    actor: StaffActor,
    db: DbSession,
    message_id: str,
    idempotency_key: Annotated[str, Depends(require_idempotency_key)],
    provider_message_id: Annotated[str | None, Query()] = None,
) -> dict[str, Any]:
    await db.rollback()
    async with db.begin():
        executed = await execute_command(
            db,
            context=user_context(
                user_id=actor.id,
                operation="message.delivery.confirm",
                idempotency_key=idempotency_key,
            ),
            payload={
                "message_id": message_id,
                "provider_message_id": provider_message_id,
            },
            handler=lambda context: confirm_message_delivery_command(
                db,
                context=context,
                message_id=message_id,
                provider_message_id=provider_message_id,
            ),
        )
    return executed.result.response


@router.post("/messages/{message_id}/resend-safe")
async def resend_message_safe(
    actor: StaffActor,
    db: DbSession,
    message_id: str,
    idempotency_key: Annotated[str, Depends(require_idempotency_key)],
) -> dict[str, Any]:
    await db.rollback()
    async with db.begin():
        executed = await execute_command(
            db,
            context=user_context(
                user_id=actor.id,
                operation="message.delivery.resend_safe",
                idempotency_key=idempotency_key,
            ),
            payload={"message_id": message_id},
            handler=lambda context: resend_message_safe_command(
                db, context=context, message_id=message_id
            ),
        )
    return executed.result.response
