from datetime import UTC, datetime
from typing import Any
from uuid import uuid4

import httpx
from sqlalchemy import func, insert, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.channels.telegram import TelegramAdapter
from app.core.config import get_settings
from app.db.tables import (
    channel_identity_table,
    conversation_message_table,
    conversation_table,
    delivery_attempt_table,
)
from app.observability.metrics import incr

AMBIGUOUS_TELEGRAM_ERRORS = (
    httpx.TimeoutException,
    httpx.ConnectError,
    httpx.RemoteProtocolError,
    httpx.ReadError,
    httpx.WriteError,
    httpx.NetworkError,
)


def _is_ambiguous_after_send_start(error: Exception) -> bool:
    if isinstance(error, AMBIGUOUS_TELEGRAM_ERRORS):
        return True
    if isinstance(error, httpx.HTTPStatusError):
        # 5xx after request left our process: treat as ambiguous.
        return error.response is not None and error.response.status_code >= 500
    return False


async def deliver_telegram_message(
    db: AsyncSession, event: dict[str, Any]
) -> None:
    message_id = str(event["payloadJson"].get("message_id") or "")
    if not message_id:
        raise ValueError("message.send.requested.v1 requires message_id")
    row = (
        await db.execute(
            select(
                conversation_message_table,
                conversation_table.c.leadId,
                conversation_table.c.studentId,
                conversation_table.c.automationPausedAt,
            )
            .join(
                conversation_table,
                conversation_table.c.id == conversation_message_table.c.conversationId,
            )
            .where(conversation_message_table.c.id == message_id)
        )
    ).mappings().first()
    if row is None:
        raise ValueError("Outbound message not found")
    if row.direction != "OUTBOUND":
        raise ValueError("Only outbound messages can be delivered")
    if row.policyStatus not in {"ALLOWED", "APPROVED"}:
        raise ValueError("Outbound message has not passed policy")
    if row.automationPausedAt is not None:
        raise ValueError("Conversation automation is paused")
    if not row.body:
        raise ValueError("Telegram text message is empty")

    prior_success = (
        await db.execute(
            select(delivery_attempt_table.c.providerResponseId).where(
                delivery_attempt_table.c.messageId == message_id,
                delivery_attempt_table.c.provider == "TELEGRAM",
                delivery_attempt_table.c.status == "SUCCESS",
            )
        )
    ).scalar_one_or_none()
    if prior_success:
        return

    identity_condition = (
        channel_identity_table.c.leadId == row.leadId
        if row.leadId
        else channel_identity_table.c.studentId == row.studentId
    )
    identity = (
        await db.execute(
            select(channel_identity_table).where(
                channel_identity_table.c.channel == "TELEGRAM",
                identity_condition,
            )
        )
    ).mappings().first()
    if identity is None:
        raise ValueError("Telegram channel identity not found")
    chat_id = (identity.metadataJson or {}).get("chat_id")
    if not chat_id:
        raise ValueError("Telegram chat id is missing")

    attempt = (
        await db.execute(
            select(func.count())
            .select_from(delivery_attempt_table)
            .where(
                delivery_attempt_table.c.messageId == message_id,
                delivery_attempt_table.c.provider == "TELEGRAM",
            )
        )
    ).scalar_one() + 1
    attempt_id = uuid4().hex
    now = datetime.now(UTC)
    await db.execute(
        insert(delivery_attempt_table).values(
            id=attempt_id,
            messageId=message_id,
            outboxEventId=event["id"],
            provider="TELEGRAM",
            attempt=attempt,
            status="PROCESSING",
            createdAt=now,
        )
    )
    try:
        provider_message_id = await TelegramAdapter(
            get_settings().telegram_bot_token
        ).send_text(
            str(chat_id),
            row.body,
            idempotency_key=event["idempotencyKey"],
        )
    except Exception as error:
        if _is_ambiguous_after_send_start(error):
            await db.execute(
                update(delivery_attempt_table)
                .where(delivery_attempt_table.c.id == attempt_id)
                .values(
                    status="UNKNOWN_REQUIRES_REVIEW",
                    errorCode=type(error).__name__,
                    errorMessage=str(error)[:1000],
                )
            )
            await db.execute(
                update(conversation_message_table)
                .where(conversation_message_table.c.id == message_id)
                .values(
                    deliveryStatus="UNKNOWN_REQUIRES_REVIEW",
                    updatedAt=now,
                )
            )
            incr("unknown_delivery", provider="TELEGRAM")
            return
        await db.execute(
            update(delivery_attempt_table)
            .where(delivery_attempt_table.c.id == attempt_id)
            .values(
                status="FAILED",
                errorCode=type(error).__name__,
                errorMessage=str(error)[:1000],
            )
        )
        raise
    await db.execute(
        update(delivery_attempt_table)
        .where(delivery_attempt_table.c.id == attempt_id)
        .values(
            status="SUCCESS",
            providerResponseId=provider_message_id,
        )
    )
    await db.execute(
        update(conversation_message_table)
        .where(conversation_message_table.c.id == message_id)
        .values(
            providerMessageId=provider_message_id,
            deliveryStatus="SENT",
            sentAt=now,
            updatedAt=now,
        )
    )
    await db.execute(
        update(conversation_table)
        .where(conversation_table.c.id == row.conversationId)
        .values(lastOutboundAt=now, updatedAt=now)
    )
