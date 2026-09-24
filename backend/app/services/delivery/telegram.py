"""Telegram outbound delivery with prepare / call / finalize.

Telegram Bot API has no real provider-side idempotency for ``sendMessage``;
``X-IMMIGROME-Idempotency-Key`` is local-only.

**At-most-once automatic delivery:** the outbox worker commits a durable
``DeliveryAttempt`` in ``PROCESSING`` *before* any HTTP call. After a
successful send, finalize marks SUCCESS. If the process crashes after send
but before finalize, reclaim finds ``PROCESSING`` (or
``UNKNOWN_REQUIRES_REVIEW``) and must **not** auto-resend — it leaves /
ensures ``UNKNOWN_REQUIRES_REVIEW`` for human confirmation.

Ambiguous transport/5xx errors during the call also finalize as
``UNKNOWN_REQUIRES_REVIEW``. Definite client errors fail the attempt and may
retry the outbox event (ordinary retry). Hermes/Calendar use separate
idempotent recovery; Telegram does not automatically resend after ambiguity.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any, Literal
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

TelegramPrepareAction = Literal["send", "skip_success", "skip_unknown"]


@dataclass(frozen=True)
class PreparedTelegramDelivery:
    action: TelegramPrepareAction
    message_id: str
    conversation_id: str | None
    chat_id: str | None
    body: str | None
    attempt_id: str | None
    idempotency_key: str


@dataclass(frozen=True)
class TelegramCallResult:
    provider_message_id: str


def _is_ambiguous_after_send_start(error: Exception) -> bool:
    if isinstance(error, AMBIGUOUS_TELEGRAM_ERRORS):
        return True
    if isinstance(error, httpx.HTTPStatusError):
        return error.response is not None and error.response.status_code >= 500
    return False


async def _mark_message_unknown(
    db: AsyncSession, message_id: str, *, now: datetime
) -> None:
    await db.execute(
        update(conversation_message_table)
        .where(conversation_message_table.c.id == message_id)
        .values(deliveryStatus="UNKNOWN_REQUIRES_REVIEW", updatedAt=now)
    )


async def _ensure_unknown_attempt(
    db: AsyncSession,
    *,
    message_id: str,
    outbox_event_id: str,
    error_code: str,
    error_message: str,
    attempt_id: str | None = None,
) -> None:
    now = datetime.now(UTC)
    if attempt_id:
        await db.execute(
            update(delivery_attempt_table)
            .where(delivery_attempt_table.c.id == attempt_id)
            .values(
                status="UNKNOWN_REQUIRES_REVIEW",
                errorCode=error_code,
                errorMessage=error_message[:1000],
            )
        )
    else:
        processing = (
            await db.execute(
                select(delivery_attempt_table).where(
                    delivery_attempt_table.c.messageId == message_id,
                    delivery_attempt_table.c.provider == "TELEGRAM",
                    delivery_attempt_table.c.status == "PROCESSING",
                )
            )
        ).mappings().all()
        for row in processing:
            await db.execute(
                update(delivery_attempt_table)
                .where(delivery_attempt_table.c.id == row.id)
                .values(
                    status="UNKNOWN_REQUIRES_REVIEW",
                    errorCode=error_code,
                    errorMessage=error_message[:1000],
                )
            )
        if not processing:
            existing_unknown = (
                await db.execute(
                    select(delivery_attempt_table.c.id).where(
                        delivery_attempt_table.c.messageId == message_id,
                        delivery_attempt_table.c.provider == "TELEGRAM",
                        delivery_attempt_table.c.status == "UNKNOWN_REQUIRES_REVIEW",
                    )
                )
            ).scalar_one_or_none()
            if existing_unknown is None:
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
                await db.execute(
                    insert(delivery_attempt_table).values(
                        id=uuid4().hex,
                        messageId=message_id,
                        outboxEventId=outbox_event_id,
                        provider="TELEGRAM",
                        attempt=attempt,
                        status="UNKNOWN_REQUIRES_REVIEW",
                        errorCode=error_code,
                        errorMessage=error_message[:1000],
                        createdAt=now,
                    )
                )
    await _mark_message_unknown(db, message_id, now=now)
    incr("unknown_delivery", provider="TELEGRAM")


async def prepare_telegram_delivery(
    db: AsyncSession, event: dict[str, Any]
) -> PreparedTelegramDelivery:
    """Short DB transaction: load message, fence priors, insert PROCESSING attempt.

    Must COMMIT before ``call_telegram_delivery``. Does not perform HTTP.
    """
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
    if prior_success is not None:
        return PreparedTelegramDelivery(
            action="skip_success",
            message_id=message_id,
            conversation_id=row.conversationId,
            chat_id=None,
            body=None,
            attempt_id=None,
            idempotency_key=event["idempotencyKey"],
        )

    prior_ambiguous = (
        await db.execute(
            select(delivery_attempt_table.c.id, delivery_attempt_table.c.status).where(
                delivery_attempt_table.c.messageId == message_id,
                delivery_attempt_table.c.provider == "TELEGRAM",
                delivery_attempt_table.c.status.in_(
                    ("PROCESSING", "UNKNOWN_REQUIRES_REVIEW")
                ),
            )
        )
    ).mappings().first()
    if prior_ambiguous is not None:
        # At-most-once: never auto-resend after PROCESSING/unknown.
        await _ensure_unknown_attempt(
            db,
            message_id=message_id,
            outbox_event_id=event["id"],
            error_code="AMBIGUOUS_PRIOR_ATTEMPT",
            error_message=(
                f"Prior attempt {prior_ambiguous.status}; automatic resend suppressed"
            ),
            attempt_id=(
                prior_ambiguous.id
                if prior_ambiguous.status == "PROCESSING"
                else None
            ),
        )
        return PreparedTelegramDelivery(
            action="skip_unknown",
            message_id=message_id,
            conversation_id=row.conversationId,
            chat_id=None,
            body=None,
            attempt_id=None,
            idempotency_key=event["idempotencyKey"],
        )

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
    return PreparedTelegramDelivery(
        action="send",
        message_id=message_id,
        conversation_id=row.conversationId,
        chat_id=str(chat_id),
        body=row.body,
        attempt_id=attempt_id,
        idempotency_key=event["idempotencyKey"],
    )


async def call_telegram_delivery(
    prepared: PreparedTelegramDelivery,
) -> TelegramCallResult:
    """HTTP send outside any DB transaction (run under lease heartbeat)."""
    if prepared.action != "send":
        raise RuntimeError("call_telegram_delivery requires action=send")
    assert prepared.chat_id is not None and prepared.body is not None
    provider_message_id = await TelegramAdapter(
        get_settings().telegram_bot_token
    ).send_text(
        prepared.chat_id,
        prepared.body,
        idempotency_key=prepared.idempotency_key,
    )
    return TelegramCallResult(provider_message_id=provider_message_id)


async def finalize_telegram_delivery(
    db: AsyncSession,
    prepared: PreparedTelegramDelivery,
    *,
    result: TelegramCallResult | None = None,
    error: Exception | None = None,
) -> Literal["success", "unknown", "failed"]:
    """Update DeliveryAttempt / message after the external call. No HTTP."""
    now = datetime.now(UTC)
    if prepared.action in {"skip_success", "skip_unknown"}:
        return "success" if prepared.action == "skip_success" else "unknown"

    if prepared.attempt_id is None:
        raise RuntimeError("finalize_telegram_delivery missing attempt_id")

    if result is not None:
        await db.execute(
            update(delivery_attempt_table)
            .where(delivery_attempt_table.c.id == prepared.attempt_id)
            .values(
                status="SUCCESS",
                providerResponseId=result.provider_message_id,
            )
        )
        await db.execute(
            update(conversation_message_table)
            .where(conversation_message_table.c.id == prepared.message_id)
            .values(
                providerMessageId=result.provider_message_id,
                deliveryStatus="SENT",
                sentAt=now,
                updatedAt=now,
            )
        )
        if prepared.conversation_id:
            await db.execute(
                update(conversation_table)
                .where(conversation_table.c.id == prepared.conversation_id)
                .values(lastOutboundAt=now, updatedAt=now)
            )
        return "success"

    if error is None:
        raise RuntimeError("finalize_telegram_delivery requires result or error")

    if _is_ambiguous_after_send_start(error):
        await _ensure_unknown_attempt(
            db,
            message_id=prepared.message_id,
            outbox_event_id="",
            error_code=type(error).__name__,
            error_message=str(error),
            attempt_id=prepared.attempt_id,
        )
        return "unknown"

    await db.execute(
        update(delivery_attempt_table)
        .where(delivery_attempt_table.c.id == prepared.attempt_id)
        .values(
            status="FAILED",
            errorCode=type(error).__name__,
            errorMessage=str(error)[:1000],
        )
    )
    return "failed"


async def deliver_telegram_message(
    db: AsyncSession, event: dict[str, Any]
) -> None:
    """Compatibility helper for in-process tests.

    Prefer prepare → call → finalize via the outbox worker so HTTP never runs
    inside the prepare transaction. This helper still sequences all three and
    must not be used when ``db`` is held open across the HTTP call in production.
    """
    prepared = await prepare_telegram_delivery(db, event)
    if prepared.action != "send":
        return
    # Flush prepare marker before HTTP when the caller shares one session.
    await db.flush()
    try:
        result = await call_telegram_delivery(prepared)
    except Exception as error:
        outcome = await finalize_telegram_delivery(db, prepared, error=error)
        if outcome == "failed":
            raise
        return
    await finalize_telegram_delivery(db, prepared, result=result)
