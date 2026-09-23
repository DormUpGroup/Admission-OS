from datetime import UTC, datetime
from typing import Any
from uuid import uuid4

from sqlalchemy import insert, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.tables import (
    activity_table,
    approval_request_table,
    conversation_message_table,
    conversation_table,
)
from app.events.records import append_audit, append_outbox
from app.orchestration.safety import evaluate_outbound_text
from app.schemas.messages import SendMessageRequest
from app.services.commands.base import CommandContext, CommandResult


async def _portal_conversation(
    db: AsyncSession,
    *,
    student_id: str,
    curator_id: str | None,
    now: datetime,
) -> dict[str, Any]:
    conversation = (
        await db.execute(
            select(conversation_table)
            .where(
                conversation_table.c.studentId == student_id,
                conversation_table.c.channel == "PORTAL",
                conversation_table.c.status == "OPEN",
            )
            .with_for_update()
        )
    ).mappings().first()
    if conversation:
        return dict(conversation)
    conversation_id = uuid4().hex
    try:
        async with db.begin_nested():
            await db.execute(
                insert(conversation_table).values(
                    id=conversation_id,
                    channel="PORTAL",
                    status="OPEN",
                    studentId=student_id,
                    assignedCuratorId=curator_id,
                    version=1,
                    createdAt=now,
                    updatedAt=now,
                )
            )
    except IntegrityError:
        conversation = (
            await db.execute(
                select(conversation_table)
                .where(
                    conversation_table.c.studentId == student_id,
                    conversation_table.c.channel == "PORTAL",
                    conversation_table.c.status == "OPEN",
                )
                .with_for_update()
            )
        ).mappings().first()
        if conversation is None:
            raise
        return dict(conversation)
    return {
        "id": conversation_id,
        "studentId": student_id,
        "version": 1,
    }


async def propose_message_command(
    db: AsyncSession,
    *,
    context: CommandContext,
    conversation_id: str,
    text: str,
) -> CommandResult:
    conversation = (
        await db.execute(
            select(conversation_table).where(conversation_table.c.id == conversation_id)
        )
    ).mappings().first()
    if conversation is None:
        raise ValueError("Conversation not found")
    if conversation.automationPausedAt is not None:
        raise ValueError("Conversation automation is paused")
    existing = (
        await db.execute(
            select(conversation_message_table).where(
                conversation_message_table.c.clientRequestId == context.idempotency_key
            )
        )
    ).mappings().first()
    if existing:
        return CommandResult(
            response={
                "message_id": existing.id,
                "policy_status": existing.policyStatus,
            },
            entity_type="ConversationMessage",
            entity_id=existing.id,
        )
    message_id = uuid4().hex
    now = datetime.now(UTC)
    await db.execute(
        insert(conversation_message_table).values(
            id=message_id,
            conversationId=conversation_id,
            clientRequestId=context.idempotency_key,
            direction="OUTBOUND",
            senderType="AGENT",
            body=text,
            deliveryStatus="DRAFT",
            policyStatus="PENDING",
            createdAt=now,
            updatedAt=now,
        )
    )
    await append_audit(
        db,
        actor_type=context.actor_type,
        actor_id=context.actor_id,
        user_id=context.actor_id if context.actor_type == "USER" else None,
        action="message.propose",
        entity_type="ConversationMessage",
        entity_id=message_id,
        correlation_id=context.correlation_id,
        after={"conversationId": conversation_id, "deliveryStatus": "DRAFT"},
        now=now,
    )
    return CommandResult(
        response={"message_id": message_id, "policy_status": "PENDING"},
        http_status=201,
        entity_type="ConversationMessage",
        entity_id=message_id,
    )


async def request_send_message_command(
    db: AsyncSession,
    *,
    context: CommandContext,
    message_id: str,
    template_key: str | None = None,
) -> CommandResult:
    message = (
        await db.execute(
            select(conversation_message_table).where(
                conversation_message_table.c.id == message_id
            )
        )
    ).mappings().first()
    if message is None:
        raise ValueError("Message not found")
    if message.deliveryStatus == "SENT":
        return CommandResult(
            response={"message_id": message_id, "status": "SENT"},
            entity_type="ConversationMessage",
            entity_id=message_id,
        )
    decision = evaluate_outbound_text(message.body or "", template_key=template_key)
    now = datetime.now(UTC)
    if decision.status == "BLOCKED":
        await db.execute(
            update(conversation_message_table)
            .where(conversation_message_table.c.id == message_id)
            .values(policyStatus="BLOCKED", deliveryStatus="BLOCKED", updatedAt=now)
        )
        return CommandResult(
            response={
                "message_id": message_id,
                "status": "BLOCKED",
                "reason": decision.reason,
            },
            entity_type="ConversationMessage",
            entity_id=message_id,
        )
    if decision.status == "APPROVAL_REQUIRED":
        existing = (
            await db.execute(
                select(approval_request_table.c.id).where(
                    approval_request_table.c.subjectType == "ConversationMessage",
                    approval_request_table.c.subjectId == message_id,
                    approval_request_table.c.status == "PENDING",
                )
            )
        ).scalar_one_or_none()
        approval_id = existing or uuid4().hex
        if not existing:
            await db.execute(
                insert(approval_request_table).values(
                    id=approval_id,
                    action="message.send",
                    riskClass=decision.risk_class,
                    status="PENDING",
                    subjectType="ConversationMessage",
                    subjectId=message_id,
                    proposedJson={"message_id": message_id},
                    createdAt=now,
                    updatedAt=now,
                )
            )
        await db.execute(
            update(conversation_message_table)
            .where(conversation_message_table.c.id == message_id)
            .values(policyStatus="APPROVAL_REQUIRED", updatedAt=now)
        )
        return CommandResult(
            response={
                "message_id": message_id,
                "status": "APPROVAL_REQUIRED",
                "approval_id": approval_id,
                "reason": decision.reason,
            },
            entity_type="ConversationMessage",
            entity_id=message_id,
        )
    await db.execute(
        update(conversation_message_table)
        .where(conversation_message_table.c.id == message_id)
        .values(policyStatus="ALLOWED", deliveryStatus="QUEUED", updatedAt=now)
    )
    await append_outbox(
        db,
        aggregate_type="ConversationMessage",
        aggregate_id=message_id,
        event_type="message.send.requested.v1",
        payload={"message_id": message_id},
        idempotency_key=f"message:send:{context.idempotency_key}",
        now=now,
    )
    return CommandResult(
        response={"message_id": message_id, "status": "QUEUED"},
        entity_type="ConversationMessage",
        entity_id=message_id,
    )


async def _portal_conversation(
    db: AsyncSession,
    *,
    student_id: str,
    curator_id: str | None,
    now: datetime,
) -> dict[str, Any]:
    conversation = (
        await db.execute(
            select(conversation_table)
            .where(
                conversation_table.c.studentId == student_id,
                conversation_table.c.channel == "PORTAL",
                conversation_table.c.status == "OPEN",
            )
            .with_for_update()
        )
    ).mappings().first()
    if conversation:
        return dict(conversation)
    conversation_id = uuid4().hex
    await db.execute(
        insert(conversation_table).values(
            id=conversation_id,
            channel="PORTAL",
            status="OPEN",
            studentId=student_id,
            assignedCuratorId=curator_id,
            version=1,
            createdAt=now,
            updatedAt=now,
        )
    )
    return {
        "id": conversation_id,
        "studentId": student_id,
        "version": 1,
    }


async def send_portal_message_command(
    db: AsyncSession,
    *,
    context: CommandContext,
    request: SendMessageRequest,
    student_id: str,
    curator_id: str | None,
    from_student: bool,
    author: str,
) -> CommandResult:
    now = datetime.now(UTC)
    conversation = await _portal_conversation(
        db, student_id=student_id, curator_id=curator_id, now=now
    )
    message_id = uuid4().hex
    attachments = [item.model_dump(by_alias=False) for item in request.attachments]
    text = request.text.strip()
    await db.execute(
        insert(conversation_message_table).values(
            id=message_id,
            conversationId=conversation["id"],
            clientRequestId=(
                f"{context.principal_id}:{context.operation}:"
                f"{context.idempotency_key}"
            ),
            direction="INBOUND" if from_student else "OUTBOUND",
            senderType="STUDENT" if from_student else "STAFF",
            senderUserId=context.actor_id,
            body=text or None,
            attachmentsJson=attachments,
            deliveryStatus="DELIVERED",
            policyStatus="APPROVED",
            sentAt=now,
            createdAt=now,
            updatedAt=now,
        )
    )
    await db.execute(
        update(conversation_table)
        .where(conversation_table.c.id == conversation["id"])
        .values(
            **(
                {"lastInboundAt": now}
                if from_student
                else {"lastOutboundAt": now}
            ),
            assignedCuratorId=curator_id,
            version=conversation_table.c.version + 1,
            updatedAt=now,
        )
    )
    await db.execute(
        insert(activity_table).values(
            id=uuid4().hex,
            type="MESSAGE_SENT",
            studentId=student_id,
            userId=context.actor_id,
            metadata='{"channel":"PORTAL","source":"python-command"}',
            createdAt=now,
        )
    )
    await append_audit(
        db,
        actor_type=context.actor_type,
        actor_id=context.actor_id,
        user_id=context.actor_id,
        action="message.send",
        entity_type="ConversationMessage",
        entity_id=message_id,
        correlation_id=context.correlation_id,
        after={
            "conversationId": conversation["id"],
            "direction": "INBOUND" if from_student else "OUTBOUND",
            "deliveryStatus": "DELIVERED",
        },
        metadata={"bodyLength": len(text), "attachmentCount": len(attachments)},
        now=now,
    )
    await append_outbox(
        db,
        aggregate_type="Conversation",
        aggregate_id=conversation["id"],
        event_type=(
            "conversation.message_received.v1"
            if from_student
            else "conversation.message_sent.v1"
        ),
        payload={
            "conversation_id": conversation["id"],
            "message_id": message_id,
            "student_id": student_id,
        },
        idempotency_key=f"message:send:{context.idempotency_key}",
        now=now,
    )
    return CommandResult(
        response={
            "id": message_id,
            "student_id": student_id,
            "text": text,
            "from_student": from_student,
            "author": author,
            "attachments": attachments,
            "created_at": now,
        },
        http_status=201,
        entity_type="ConversationMessage",
        entity_id=message_id,
    )


async def confirm_message_delivery_command(
    db: AsyncSession,
    *,
    context: CommandContext,
    message_id: str,
    provider_message_id: str | None = None,
) -> CommandResult:
    now = datetime.now(UTC)
    message = (
        await db.execute(
            select(conversation_message_table)
            .where(conversation_message_table.c.id == message_id)
            .with_for_update()
        )
    ).mappings().first()
    if message is None:
        raise ValueError("Message not found")
    if message.deliveryStatus == "SENT":
        return CommandResult(
            response={"message_id": message_id, "status": "SENT"},
            entity_type="ConversationMessage",
            entity_id=message_id,
        )
    if message.deliveryStatus != "UNKNOWN_REQUIRES_REVIEW":
        raise ValueError("Only UNKNOWN_REQUIRES_REVIEW messages can be confirmed")
    await db.execute(
        update(conversation_message_table)
        .where(conversation_message_table.c.id == message_id)
        .values(
            deliveryStatus="SENT",
            providerMessageId=provider_message_id or message.providerMessageId,
            sentAt=now,
            updatedAt=now,
        )
    )
    await append_audit(
        db,
        actor_type=context.actor_type,
        actor_id=context.actor_id,
        user_id=context.actor_id if context.actor_type == "USER" else None,
        action="message.delivery.confirm",
        entity_type="ConversationMessage",
        entity_id=message_id,
        correlation_id=context.correlation_id,
        before={"deliveryStatus": "UNKNOWN_REQUIRES_REVIEW"},
        after={"deliveryStatus": "SENT"},
        now=now,
    )
    return CommandResult(
        response={"message_id": message_id, "status": "SENT"},
        entity_type="ConversationMessage",
        entity_id=message_id,
    )


async def resend_message_safe_command(
    db: AsyncSession,
    *,
    context: CommandContext,
    message_id: str,
) -> CommandResult:
    now = datetime.now(UTC)
    message = (
        await db.execute(
            select(conversation_message_table)
            .where(conversation_message_table.c.id == message_id)
            .with_for_update()
        )
    ).mappings().first()
    if message is None:
        raise ValueError("Message not found")
    if message.deliveryStatus == "SENT":
        return CommandResult(
            response={"message_id": message_id, "status": "SENT"},
            entity_type="ConversationMessage",
            entity_id=message_id,
        )
    if message.deliveryStatus not in {"UNKNOWN_REQUIRES_REVIEW", "FAILED", "QUEUED"}:
        raise ValueError("Message is not eligible for safe resend")
    await db.execute(
        update(conversation_message_table)
        .where(conversation_message_table.c.id == message_id)
        .values(deliveryStatus="QUEUED", policyStatus="ALLOWED", updatedAt=now)
    )
    await append_outbox(
        db,
        aggregate_type="ConversationMessage",
        aggregate_id=message_id,
        event_type="message.send.requested.v1",
        payload={"message_id": message_id},
        idempotency_key=f"message:resend:{context.idempotency_key}",
        now=now,
    )
    await append_audit(
        db,
        actor_type=context.actor_type,
        actor_id=context.actor_id,
        user_id=context.actor_id if context.actor_type == "USER" else None,
        action="message.delivery.resend_safe",
        entity_type="ConversationMessage",
        entity_id=message_id,
        correlation_id=context.correlation_id,
        after={"deliveryStatus": "QUEUED"},
        now=now,
    )
    return CommandResult(
        response={"message_id": message_id, "status": "QUEUED"},
        entity_type="ConversationMessage",
        entity_id=message_id,
    )
