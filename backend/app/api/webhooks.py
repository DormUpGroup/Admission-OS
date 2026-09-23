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
    content_length = request.headers.get("content-length")
    if content_length and int(content_length) > MAX_WEBHOOK_BYTES:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail="Webhook payload is too large",
        )
    payload = await request.json()
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
