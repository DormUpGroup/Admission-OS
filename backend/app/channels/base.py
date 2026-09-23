from dataclasses import dataclass, field
from typing import Any, Protocol


@dataclass(frozen=True)
class InboundMessage:
    provider_event_id: str
    provider_message_id: str
    external_user_id: str
    external_chat_id: str
    username: str | None
    display_name: str | None
    text: str
    attachments: list[dict[str, Any]] = field(default_factory=list)


class ChannelAdapter(Protocol):
    channel: str

    def normalize(self, payload: dict[str, Any]) -> InboundMessage | None: ...

    async def send_text(
        self, external_chat_id: str, text: str, *, idempotency_key: str
    ) -> str: ...
