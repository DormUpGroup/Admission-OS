import json
from datetime import UTC, datetime

from sqlalchemy import func, insert, select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.db.tables import (
    activity_table,
    conversation_message_table,
    conversation_table,
    metadata,
    student_table,
)
from app.services.migrations.messages import backfill_portal_messages


async def test_portal_message_backfill_is_idempotent() -> None:
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    async with engine.begin() as connection:
        await connection.run_sync(metadata.create_all)
    factory = async_sessionmaker(engine, expire_on_commit=False)
    now = datetime.now(UTC)
    async with factory() as db:
        async with db.begin():
            await db.execute(
                insert(student_table).values(
                    id="student_1",
                    firstName="Ada",
                    lastName="Lovelace",
                    email="ada@example.com",
                    status="ACTIVE",
                    journeyStage="PROFILE",
                    riskLevel="NONE",
                    intake="2027/28",
                    studyLevel="BACHELOR",
                    accompanimentStatus="NONE",
                    version=1,
                    createdAt=now,
                    updatedAt=now,
                )
            )
            await db.execute(
                insert(activity_table).values(
                    id="activity_1",
                    type="NOTE",
                    studentId="student_1",
                    userId="user_1",
                    metadata=json.dumps(
                        {
                            "channel": "student-curator",
                            "from": "student",
                            "note": "Hello",
                            "attachments": [],
                        }
                    ),
                    createdAt=now,
                )
            )
    async with factory() as db:
        async with db.begin():
            first = await backfill_portal_messages(db)
    async with factory() as db:
        async with db.begin():
            second = await backfill_portal_messages(db)
        conversations = (
            await db.execute(select(func.count()).select_from(conversation_table))
        ).scalar_one()
        messages = (
            await db.execute(
                select(func.count()).select_from(conversation_message_table)
            )
        ).scalar_one()
    assert first["conversations_created"] == 1
    assert first["messages_created"] == 1
    assert second["messages_created"] == 0
    assert conversations == 1
    assert messages == 1
    await engine.dispose()
