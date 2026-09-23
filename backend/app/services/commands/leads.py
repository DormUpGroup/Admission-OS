from datetime import UTC, datetime
from typing import Any

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.tables import lead_table
from app.events.records import append_audit
from app.services.commands.base import CommandContext, CommandResult

ALLOWED_QUALIFICATION_FIELDS = frozenset(
    {
        "email",
        "phone",
        "country",
        "nationality",
        "study_level",
        "intake",
        "target_field",
        "preferred_language",
    }
)
REQUIRED_QUALIFICATION_FIELDS = frozenset(
    {"country", "study_level", "intake", "target_field"}
)


async def update_lead_qualification_command(
    db: AsyncSession,
    *,
    context: CommandContext,
    lead_id: str,
    fields: dict[str, Any],
) -> CommandResult:
    unknown = set(fields) - ALLOWED_QUALIFICATION_FIELDS
    if unknown:
        raise ValueError(f"Unsupported qualification fields: {sorted(unknown)}")
    row = (
        await db.execute(select(lead_table).where(lead_table.c.id == lead_id))
    ).mappings().first()
    if row is None:
        raise ValueError("Lead not found")
    qualification = dict(row.qualificationJson or {})
    qualification.update(fields)
    direct_updates: dict[str, Any] = {"qualificationJson": qualification}
    if "email" in fields:
        direct_updates["email"] = fields["email"]
    if "phone" in fields:
        direct_updates["phone"] = fields["phone"]
    next_status = (
        "QUALIFIED"
        if REQUIRED_QUALIFICATION_FIELDS.issubset(qualification)
        else "QUALIFYING"
    )
    now = datetime.now(UTC)
    direct_updates.update(status=next_status, updatedAt=now)
    await db.execute(
        update(lead_table).where(lead_table.c.id == lead_id).values(**direct_updates)
    )
    await append_audit(
        db,
        actor_type=context.actor_type,
        actor_id=context.actor_id,
        user_id=context.actor_id if context.actor_type == "USER" else None,
        action="lead.qualification.update",
        entity_type="Lead",
        entity_id=lead_id,
        correlation_id=context.correlation_id,
        before={"status": row.status, "qualification": row.qualificationJson or {}},
        after={"status": next_status, "qualification": qualification},
        now=now,
    )
    return CommandResult(
        response={
            "lead_id": lead_id,
            "status": next_status,
            "qualification": qualification,
        },
        entity_type="Lead",
        entity_id=lead_id,
    )
