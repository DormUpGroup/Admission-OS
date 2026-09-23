from typing import Any

import httpx

from app.channels.base import InboundMessage


class TelegramAdapter:
    channel = "TELEGRAM"

    def __init__(self, bot_token: str | None) -> None:
        self._bot_token = bot_token

    def normalize(self, payload: dict[str, Any]) -> InboundMessage | None:
        update_id = payload.get("update_id")
        message = payload.get("message") or payload.get("edited_message")
        if update_id is None or not isinstance(message, dict):
            return None
        sender = message.get("from")
        chat = message.get("chat")
        if not isinstance(sender, dict) or not isinstance(chat, dict):
            return None
        sender_id = sender.get("id")
        chat_id = chat.get("id")
        message_id = message.get("message_id")
        if sender_id is None or chat_id is None or message_id is None:
            return None
        first_name = str(sender.get("first_name") or "").strip()
        last_name = str(sender.get("last_name") or "").strip()
        display_name = " ".join(part for part in (first_name, last_name) if part) or None
        attachments: list[dict[str, Any]] = []
        if message.get("document"):
            document = message["document"]
            attachments.append(
                {
                    "kind": "document",
                    "provider_file_id": document.get("file_id"),
                    "filename": document.get("file_name"),
                    "mime_type": document.get("mime_type"),
                }
            )
        if message.get("photo"):
            photo = message["photo"][-1]
            attachments.append(
                {
                    "kind": "photo",
                    "provider_file_id": photo.get("file_id"),
                }
            )
        return InboundMessage(
            provider_event_id=str(update_id),
            provider_message_id=str(message_id),
            external_user_id=str(sender_id),
            external_chat_id=str(chat_id),
            username=str(sender.get("username")) if sender.get("username") else None,
            display_name=display_name,
            text=str(message.get("text") or message.get("caption") or "").strip(),
            attachments=attachments,
        )

    async def send_text(
        self, external_chat_id: str, text: str, *, idempotency_key: str
    ) -> str:
        if not self._bot_token:
            raise RuntimeError("TELEGRAM_BOT_TOKEN is not configured")
        async with httpx.AsyncClient(timeout=20.0) as client:
            response = await client.post(
                f"https://api.telegram.org/bot{self._bot_token}/sendMessage",
                json={
                    "chat_id": external_chat_id,
                    "text": text,
                    "disable_web_page_preview": True,
                },
                headers={"X-IMMIGROME-Idempotency-Key": idempotency_key},
            )
        response.raise_for_status()
        payload: dict[str, Any] = response.json()
        if not payload.get("ok") or not isinstance(payload.get("result"), dict):
            raise RuntimeError("Telegram returned an invalid sendMessage response")
        return str(payload["result"]["message_id"])
