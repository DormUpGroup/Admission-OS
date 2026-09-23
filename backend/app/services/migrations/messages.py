import json
from datetime import UTC, datetime
from uuid import uuid4

from sqlalchemy import insert, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.tables import (
    activity_table,
    conversation_message_table,
    conversation_table,
    student_table,
)


async def backfill_portal_messages(db: AsyncSession) -> dict[str, int]:
    activities = (
        await db.execute(
            select(
                activity_table,
                student_table.c.curatorId,
            )
            .join(student_table, student_table.c.id == activity_table.c.studentId)
            .where(activity_table.c.type == "NOTE")
            .order_by(activity_table.c.createdAt, activity_table.c.id)
        )
    ).mappings().all()
    existing_legacy_ids = set(
        (
            await db.execute(
                select(conversation_message_table.c.legacyActivityId).where(
                    conversation_message_table.c.legacyActivityId.is_not(None)
                )
            )
        ).scalars()
    )
    conversations = {
        row.studentId: dict(row)
        for row in (
            await db.execute(
                select(conversation_table).where(
                    conversation_table.c.channel == "PORTAL",
                    conversation_table.c.status == "OPEN",
                    conversation_table.c.studentId.is_not(None),
                )
            )
        ).mappings()
    }
    created_conversations = 0
    created_messages = 0
    skipped = 0
    for activity in activities:
        if activity.id in existing_legacy_ids:
            skipped += 1
            continue
        try:
            metadata = json.loads(activity.metadata or "{}")
        except json.JSONDecodeError:
            skipped += 1
            continue
        attachments = metadata.get("attachments")
        if metadata.get("channel") != "student-curator" or not (
            str(metadata.get("note") or "").strip()
            or isinstance(attachments, list) and attachments
        ):
            skipped += 1
            continue
        conversation = conversations.get(activity.studentId)
        if conversation is None:
            now = datetime.now(UTC)
            conversation = {
                "id": uuid4().hex,
                "studentId": activity.studentId,
            }
            await db.execute(
                insert(conversation_table).values(
                    id=conversation["id"],
                    channel="PORTAL",
                    status="OPEN",
                    studentId=activity.studentId,
                    assignedCuratorId=activity.curatorId,
                    version=1,
                    createdAt=activity.createdAt,
                    updatedAt=now,
                )
            )
            conversations[activity.studentId] = conversation
            created_conversations += 1
        from_student = metadata.get("from") == "student"
        await db.execute(
            insert(conversation_message_table).values(
                id=uuid4().hex,
                conversationId=conversation["id"],
                legacyActivityId=activity.id,
                direction="INBOUND" if from_student else "OUTBOUND",
                senderType="STUDENT" if from_student else "STAFF",
                senderUserId=activity.userId,
                body=str(metadata.get("note") or "").strip() or None,
                attachmentsJson=attachments if isinstance(attachments, list) else [],
                deliveryStatus="DELIVERED",
                policyStatus="APPROVED",
                sentAt=activity.createdAt,
                createdAt=activity.createdAt,
                updatedAt=activity.createdAt,
            )
        )
        created_messages += 1
    return {
        "conversations_created": created_conversations,
        "messages_created": created_messages,
        "activities_skipped": skipped,
    }
