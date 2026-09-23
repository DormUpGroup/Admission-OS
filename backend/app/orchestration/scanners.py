import asyncio
from datetime import UTC, datetime, timedelta

from sqlalchemy import or_, select

from app.db.session import get_session_factory
from app.db.tables import conversation_table, lead_table, outbox_event_table
from app.events.records import append_outbox


async def schedule_due_followups(now: datetime | None = None) -> int:
    now = now or datetime.now(UTC)
    cutoff = now - timedelta(hours=24)
    factory = get_session_factory()
    created = 0
    async with factory() as db:
        async with db.begin():
            rows = (
                await db.execute(
                    select(
                        conversation_table.c.id,
                        conversation_table.c.leadId,
                        conversation_table.c.studentId,
                    )
                    .outerjoin(lead_table, lead_table.c.id == conversation_table.c.leadId)
                    .where(
                        conversation_table.c.status == "OPEN",
                        conversation_table.c.automationPausedAt.is_(None),
                        conversation_table.c.lastInboundAt.is_not(None),
                        conversation_table.c.lastInboundAt <= cutoff,
                        or_(
                            conversation_table.c.lastOutboundAt.is_(None),
                            conversation_table.c.lastOutboundAt
                            < conversation_table.c.lastInboundAt,
                        ),
                        or_(
                            conversation_table.c.leadId.is_(None),
                            lead_table.c.consentStatus != "WITHDRAWN",
                        ),
                    )
                )
            ).mappings()
            for row in rows:
                idempotency_key = f"followup:{row.id}:{now.date().isoformat()}"
                exists = (
                    await db.execute(
                        select(outbox_event_table.c.id).where(
                            outbox_event_table.c.idempotencyKey == idempotency_key
                        )
                    )
                ).scalar_one_or_none()
                if exists:
                    continue
                await append_outbox(
                    db,
                    aggregate_type="Conversation",
                    aggregate_id=row.id,
                    event_type="follow_up.due.v1",
                    payload={
                        "conversation_id": row.id,
                        "lead_id": row.leadId,
                        "student_id": row.studentId,
                    },
                    idempotency_key=idempotency_key,
                    now=now,
                )
                created += 1
    return created


def schedule_due_followups_sync() -> int:
    return asyncio.run(schedule_due_followups())
