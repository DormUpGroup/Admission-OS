import hashlib
import json
from datetime import UTC, datetime
from typing import Any
from uuid import uuid4

from sqlalchemy import insert, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.channels.base import InboundMessage
from app.db.tables import (
    channel_identity_table,
    conversation_message_table,
    conversation_table,
    inbox_event_table,
    lead_table,
)
from app.events.records import append_audit, append_outbox


def payload_hash(payload: dict[str, Any]) -> str:
    serialized = json.dumps(payload, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(serialized.encode()).hexdigest()


async def ingest_telegram_message(
    db: AsyncSession,
    *,
    raw_payload: dict[str, Any],
    message: InboundMessage,
    now: datetime | None = None,
) -> dict[str, Any]:
    now = now or datetime.now(UTC)
    existing_inbox = (
        await db.execute(
            select(inbox_event_table).where(
                inbox_event_table.c.provider == "TELEGRAM",
                inbox_event_table.c.providerEventId == message.provider_event_id,
            )
        )
    ).mappings().first()
    if existing_inbox:
        return {"duplicate": True, "inbox_event_id": existing_inbox.id}

    inbox_id = uuid4().hex
    await db.execute(
        insert(inbox_event_table).values(
            id=inbox_id,
            provider="TELEGRAM",
            providerEventId=message.provider_event_id,
            payloadHash=payload_hash(raw_payload),
            payloadJson=raw_payload,
            status="PROCESSING",
            receivedAt=now,
        )
    )

    identity = (
        await db.execute(
            select(channel_identity_table).where(
                channel_identity_table.c.channel == "TELEGRAM",
                channel_identity_table.c.externalId == message.external_user_id,
            )
        )
    ).mappings().first()

    lead_id: str | None = None
    student_id: str | None = None
    if identity is None:
        lead_id = uuid4().hex
        name_parts = (message.display_name or "").split(maxsplit=1)
        await db.execute(
            insert(lead_table).values(
                id=lead_id,
                firstName=name_parts[0] if name_parts else None,
                lastName=name_parts[1] if len(name_parts) > 1 else None,
                status="NEW",
                source="TELEGRAM",
                locale=None,
                consentStatus="UNKNOWN",
                createdAt=now,
                updatedAt=now,
            )
        )
        await db.execute(
            insert(channel_identity_table).values(
                id=uuid4().hex,
                channel="TELEGRAM",
                externalId=message.external_user_id,
                username=message.username,
                displayName=message.display_name,
                leadId=lead_id,
                studentId=None,
                metadataJson={"chat_id": message.external_chat_id},
                createdAt=now,
                updatedAt=now,
            )
        )
    else:
        lead_id = identity.leadId
        student_id = identity.studentId
        await db.execute(
            update(channel_identity_table)
            .where(channel_identity_table.c.id == identity.id)
            .values(
                username=message.username,
                displayName=message.display_name,
                metadataJson={"chat_id": message.external_chat_id},
                updatedAt=now,
            )
        )

    conversation = (
        await db.execute(
            select(conversation_table).where(
                conversation_table.c.channel == "TELEGRAM",
                (
                    conversation_table.c.leadId == lead_id
                    if lead_id
                    else conversation_table.c.studentId == student_id
                ),
                conversation_table.c.status == "OPEN",
            )
        )
    ).mappings().first()
    if conversation is None:
        conversation_id = uuid4().hex
        await db.execute(
            insert(conversation_table).values(
                id=conversation_id,
                channel="TELEGRAM",
                status="OPEN",
                leadId=lead_id,
                studentId=student_id,
                lastInboundAt=now,
                createdAt=now,
                updatedAt=now,
            )
        )
    else:
        conversation_id = conversation.id
        await db.execute(
            update(conversation_table)
            .where(conversation_table.c.id == conversation_id)
            .values(lastInboundAt=now, updatedAt=now)
        )

    existing_message = (
        await db.execute(
            select(conversation_message_table.c.id).where(
                conversation_message_table.c.conversationId == conversation_id,
                conversation_message_table.c.providerMessageId
                == message.provider_message_id,
            )
        )
    ).scalar_one_or_none()
    if existing_message:
        await db.execute(
            update(inbox_event_table)
            .where(inbox_event_table.c.id == inbox_id)
            .values(status="PROCESSED", processedAt=now)
        )
        return {
            "duplicate": True,
            "inbox_event_id": inbox_id,
            "conversation_id": conversation_id,
            "message_id": existing_message,
        }

    message_id = uuid4().hex
    normalized_command = message.text.strip().lower()
    pause_reason = None
    if normalized_command in {"/stop", "stop", "стоп"}:
        pause_reason = "CONTACT_OPT_OUT"
        if lead_id:
            await db.execute(
                update(lead_table)
                .where(lead_table.c.id == lead_id)
                .values(consentStatus="WITHDRAWN", updatedAt=now)
            )
    elif normalized_command in {"/human", "оператор", "человек"}:
        pause_reason = "HUMAN_REQUESTED"
    if pause_reason:
        await db.execute(
            update(conversation_table)
            .where(conversation_table.c.id == conversation_id)
            .values(
                automationPausedAt=now,
                automationPauseReason=pause_reason,
                updatedAt=now,
            )
        )

    await db.execute(
        insert(conversation_message_table).values(
            id=message_id,
            conversationId=conversation_id,
            providerMessageId=message.provider_message_id,
            direction="INBOUND",
            senderType="CONTACT",
            body=message.text or None,
            attachmentsJson=message.attachments or None,
            deliveryStatus="RECEIVED",
            policyStatus="BLOCKED" if pause_reason == "CONTACT_OPT_OUT" else "PENDING",
            sentAt=now,
            createdAt=now,
            updatedAt=now,
        )
    )
    await append_audit(
        db,
        actor_type="CHANNEL",
        actor_id=f"telegram:{message.external_user_id}",
        action="message.receive",
        entity_type="ConversationMessage",
        entity_id=message_id,
        correlation_id=inbox_id,
        after={"conversationId": conversation_id, "direction": "INBOUND"},
        now=now,
    )
    if not pause_reason:
        await append_outbox(
            db,
            aggregate_type="Conversation",
            aggregate_id=conversation_id,
            event_type="message.received.v1",
            payload={
                "conversation_id": conversation_id,
                "message_id": message_id,
                "lead_id": lead_id,
                "student_id": student_id,
            },
            idempotency_key=f"telegram:update:{message.provider_event_id}",
            now=now,
        )
    await db.execute(
        update(inbox_event_table)
        .where(inbox_event_table.c.id == inbox_id)
        .values(status="PROCESSED", processedAt=now)
    )
    return {
        "duplicate": False,
        "inbox_event_id": inbox_id,
        "lead_id": lead_id,
        "student_id": student_id,
        "conversation_id": conversation_id,
        "message_id": message_id,
        "automation_paused": bool(pause_reason),
    }
