from dataclasses import dataclass

_FORBIDDEN_AUTOMATED_PHRASES = (
    "гарантируем визу",
    "гарантируем поступление",
    "оплата подтверждена",
    "документ одобрен",
    "application approved",
    "visa guaranteed",
)

_SENSITIVE_MARKERS = (
    "отказ",
    "rejected",
    "возврат денег",
    "refund",
    "визовая стратегия",
    "legal advice",
)

_SECRET_MARKERS = (
    "internal_api_secret",
    "automation_api_secret",
    "telegram_bot_token",
    "hermes_mcp_key",
    "hermes_mcp_capability_secret",
    "authorization: bearer",
)


@dataclass(frozen=True)
class SafetyDecision:
    status: str
    reason: str
    risk_class: str


def evaluate_outbound_text(text: str, *, template_key: str | None = None) -> SafetyDecision:
    normalized = " ".join(text.lower().split())
    if not normalized:
        return SafetyDecision("BLOCKED", "Message is empty", "FORBIDDEN")
    if any(phrase in normalized for phrase in _FORBIDDEN_AUTOMATED_PHRASES):
        return SafetyDecision(
            "BLOCKED", "Message contains a prohibited automated claim", "FORBIDDEN"
        )
    if any(marker in normalized for marker in _SECRET_MARKERS):
        return SafetyDecision(
            "BLOCKED", "Message contains a credential or secret", "FORBIDDEN"
        )
    if any(marker in normalized for marker in _SENSITIVE_MARKERS):
        return SafetyDecision(
            "APPROVAL_REQUIRED", "Sensitive communication requires a human", "HIGH"
        )
    if len(text) > 3000:
        return SafetyDecision(
            "APPROVAL_REQUIRED", "Long personalized message requires review", "MEDIUM"
        )
    if template_key:
        return SafetyDecision("ALLOWED", "Approved template", "LOW")
    return SafetyDecision(
        "APPROVAL_REQUIRED", "Free-form agent message requires review", "MEDIUM"
    )
