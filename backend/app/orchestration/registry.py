from dataclasses import dataclass
from datetime import UTC, datetime
from decimal import Decimal
from typing import Any

from sqlalchemy import insert, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.tables import agent_definition_table


@dataclass(frozen=True)
class AgentSpec:
    key: str
    enabled: bool
    autonomy: str
    mission: str
    forbidden: tuple[str, ...]
    event_types: tuple[str, ...]
    tools: tuple[str, ...]
    output_schema: dict[str, Any]
    max_iterations: int = 8
    timeout_seconds: int = 120
    max_cost_usd: Decimal = Decimal("0.2500")
    version: str = "1.0.0"
    prompt_version: str = "v1"


_DECISION_SCHEMA = {
    "type": "object",
    "additionalProperties": False,
    "required": ["action", "reason", "confidence"],
    "properties": {
        "action": {"type": "string"},
        "reason": {"type": "string"},
        "confidence": {"type": "number", "minimum": 0, "maximum": 1},
        "tool_calls": {"type": "array", "items": {"type": "object"}},
        "draft": {"type": ["string", "null"]},
        "escalate": {"type": "boolean"},
    },
}


AGENT_SPECS: tuple[AgentSpec, ...] = (
    AgentSpec(
        "intake",
        True,
        "LOW_RISK_AUTONOMY",
        "Qualify a new contact and collect only the minimum admissions profile.",
        (
            "convert a lead to a student",
            "confirm payment",
            "promise admission or visa outcomes",
        ),
        ("message.received.v1",),
        (
            "lead.get",
            "lead.update_qualification",
            "conversation.get_recent",
            "message.propose",
            "message.request_send",
            "scheduling.request",
        ),
        _DECISION_SCHEMA,
    ),
    AgentSpec(
        "scheduling",
        True,
        "APPROVAL_FOR_EXTERNAL_WRITE",
        "Offer deterministic available slots and coordinate consultations.",
        ("invent availability", "double book", "change admission deadlines"),
        ("scheduling.requested.v1",),
        (
            "conversation.get_recent",
            "appointment.list_slots",
            "appointment.create",
            "message.propose",
            "message.request_send",
        ),
        _DECISION_SCHEMA,
    ),
    AgentSpec(
        "onboarding",
        True,
        "HUMAN_APPROVAL_REQUIRED",
        "Prepare conversion and onboarding after a verified payment or approval.",
        (
            "trust a payment claim in chat",
            "bypass cohort capacity",
            "create duplicate students",
        ),
        ("payment.confirmed.v1", "lead.conversion.approved.v1"),
        ("lead.get", "onboarding.prepare", "task.create", "document.request"),
        _DECISION_SCHEMA,
    ),
    AgentSpec(
        "document",
        True,
        "CONDITIONAL_AUTONOMY",
        "Track document gaps, requests, expiry, and required corrections.",
        ("approve documents", "read raw PII files", "change application outcome"),
        (
            "document.requested.v1",
            "document.uploaded.v1",
            "document.needs_changes.v1",
        ),
        (
            "case.get_snapshot",
            "document.list_gaps",
            "document.request",
            "message.propose",
            "message.request_send",
        ),
        _DECISION_SCHEMA,
    ),
    AgentSpec(
        "follow_up",
        True,
        "TEMPLATE_ONLY_AUTONOMY",
        "Send bounded reminders for unresolved actions under consent and quiet-hour rules.",
        ("send after opt-out", "exceed cadence", "send sensitive free-form advice"),
        ("follow_up.due.v1",),
        (
            "conversation.get_recent",
            "case.get_snapshot",
            "message.propose",
            "message.request_send",
            "task.create",
        ),
        _DECISION_SCHEMA,
    ),
    AgentSpec(
        "case_manager",
        True,
        "SHADOW",
        "Assess the whole case, explain risk, and escalate blockers to a human.",
        (
            "submit applications",
            "approve documents",
            "change payment state",
            "send client messages directly",
        ),
        ("case.recalculated.v1", "case.review.requested.v1"),
        ("case.get_snapshot", "task.create"),
        _DECISION_SCHEMA,
    ),
    AgentSpec(
        "program",
        False,
        "DRAFT_ONLY",
        "Find and compare programmes using verified official sources.",
        ("publish unverified facts", "select a programme for the client"),
        ("program.match.requested.v1",),
        (),
        _DECISION_SCHEMA,
        max_iterations=12,
        timeout_seconds=600,
        max_cost_usd=Decimal("1.5000"),
    ),
    AgentSpec(
        "country_policy",
        False,
        "DRAFT_ONLY",
        "Apply reviewed, versioned country packs to a case.",
        ("invent policy", "use an expired country pack", "provide legal guarantees"),
        ("country_policy.requested.v1",),
        (),
        _DECISION_SCHEMA,
    ),
    AgentSpec(
        "communication",
        False,
        "HUMAN_APPROVAL_REQUIRED",
        "Draft complex personalized communications and consultation summaries.",
        ("send without approval", "include unrelated client data"),
        ("communication.requested.v1",),
        ("case.get_snapshot", "conversation.get_recent", "message.propose"),
        _DECISION_SCHEMA,
    ),
    AgentSpec(
        "case_summary",
        False,
        "READ_ONLY",
        "Produce evidence-linked case briefs for staff.",
        ("change case state", "send messages"),
        ("case_summary.requested.v1",),
        ("case.get_snapshot", "conversation.get_recent"),
        _DECISION_SCHEMA,
    ),
    AgentSpec(
        "analytics",
        False,
        "READ_ONLY",
        "Explain funnel, workload, and agent quality metrics.",
        ("access message bodies by default", "change operational state"),
        ("analytics.requested.v1",),
        (),
        _DECISION_SCHEMA,
    ),
    AgentSpec(
        "qa_safety",
        True,
        "POLICY_GATE",
        "Validate identity, consent, claims, limits, and required human approval.",
        ("override deterministic policy", "send messages", "mutate cases"),
        ("agent.output.proposed.v1", "message.send.requested.v1"),
        (),
        _DECISION_SCHEMA,
        max_iterations=3,
        timeout_seconds=30,
        max_cost_usd=Decimal("0.0500"),
    ),
)

AGENTS_BY_KEY = {spec.key: spec for spec in AGENT_SPECS}


def agent_for_event(event_type: str) -> AgentSpec | None:
    matches = [
        spec for spec in AGENT_SPECS if spec.enabled and event_type in spec.event_types
    ]
    if len(matches) > 1:
        raise RuntimeError(f"Ambiguous agent routing for {event_type}")
    return matches[0] if matches else None


async def sync_agent_definitions(db: AsyncSession) -> None:
    existing = set(
        (await db.execute(select(agent_definition_table.c.key))).scalars().all()
    )
    now = datetime.now(UTC)
    for spec in AGENT_SPECS:
        values = {
            "version": spec.version,
            "enabled": spec.enabled,
            "autonomyLevel": spec.autonomy,
            "allowedToolsJson": list(spec.tools),
            "eventTypesJson": list(spec.event_types),
            "approvalPolicyJson": {
                "forbidden": list(spec.forbidden),
                "mission": spec.mission,
            },
            "promptVersion": spec.prompt_version,
            "maxIterations": spec.max_iterations,
            "timeoutSeconds": spec.timeout_seconds,
            "maxCostUsd": spec.max_cost_usd,
            "updatedAt": now,
        }
        if spec.key not in existing:
            await db.execute(
                insert(agent_definition_table).values(
                    key=spec.key, createdAt=now, **values
                )
            )
