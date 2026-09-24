import json
import secrets
from typing import Annotated, Any

from fastapi import APIRouter, Depends, Header, HTTPException, Request, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.channels.telegram import TelegramAdapter
from app.core.config import Settings, get_settings
from app.db.session import get_db_session
from app.services.commands.telegram import ingest_telegram_message

router = APIRouter(prefix="/webhooks", tags=["webhooks"])
MAX_WEBHOOK_BYTES = 1_000_000


async def _read_body_limited(request: Request, max_bytes: int) -> bytes:
    """Enforce an actual bytes-read limit (Content-Length alone is not enough)."""
    content_length = request.headers.get("content-length")
    if content_length is not None:
        try:
            if int(content_length) > max_bytes:
                raise HTTPException(
                    status_code=status.HTTP_413_CONTENT_TOO_LARGE,
                    detail="Webhook payload is too large",
                )
        except ValueError:
            pass

    chunks: list[bytes] = []
    total = 0
    async for chunk in request.stream():
        total += len(chunk)
        if total > max_bytes:
            raise HTTPException(
                status_code=status.HTTP_413_CONTENT_TOO_LARGE,
                detail="Webhook payload is too large",
            )
        chunks.append(chunk)
    return b"".join(chunks)


@router.post("/telegram", status_code=status.HTTP_202_ACCEPTED)
async def telegram_webhook(
    request: Request,
    secret_header: Annotated[
        str | None, Header(alias="X-Telegram-Bot-Api-Secret-Token")
    ] = None,
    settings: Settings = Depends(get_settings),
    db: AsyncSession = Depends(get_db_session),
) -> dict[str, Any]:
    expected = settings.telegram_webhook_secret
    if not expected:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Telegram webhook is not configured",
        )
    if not secret_header or not secrets.compare_digest(secret_header, expected):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid Telegram webhook secret",
        )
    raw_body = await _read_body_limited(request, MAX_WEBHOOK_BYTES)
    try:
        payload = json.loads(raw_body)
    except json.JSONDecodeError as error:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="Webhook payload must be valid JSON",
        ) from error
    if not isinstance(payload, dict):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="Webhook payload must be an object",
        )
    message = TelegramAdapter(settings.telegram_bot_token).normalize(payload)
    if message is None:
        return {"accepted": True, "ignored": True}
    async with db.begin():
        result = await ingest_telegram_message(
            db, raw_payload=payload, message=message
        )
    return {"accepted": True, **result}
