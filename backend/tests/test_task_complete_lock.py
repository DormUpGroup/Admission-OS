from datetime import UTC, datetime

from sqlalchemy import func, insert, select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.db.tables import activity_table, metadata, outbox_event_table, student_table, task_table
from app.services.commands.tasks import complete_task_command


async def _database():
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    async with engine.begin() as connection:
        await connection.run_sync(metadata.create_all)
    return engine, async_sessionmaker(engine, expire_on_commit=False)


async def test_concurrent_task_complete_emits_one_activity_and_outbox() -> None:
    engine, factory = await _database()
    now = datetime.now(UTC)
    async with factory() as db:
        await db.execute(
            insert(student_table).values(
                id="student_1",
                firstName="Ada",
                lastName="Lovelace",
                email="ada@example.test",
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
            insert(task_table).values(
                id="task_1",
                title="Review passport",
                status="TODO",
                priority="HIGH",
                studentId="student_1",
                isStudentFacing=False,
                createdAt=now,
                updatedAt=now,
            )
        )
        await db.commit()

    async with factory() as db:
        async with db.begin():
            await complete_task_command(
                db,
                task_id="task_1",
                task={"studentId": "student_1", "status": "TODO"},
                actor_type="USER",
                actor_id="curator_a",
                correlation_id="key-a",
                idempotency_key="task.complete:key-a",
            )
    async with factory() as db:
        async with db.begin():
            await complete_task_command(
                db,
                task_id="task_1",
                task={"studentId": "student_1", "status": "TODO"},
                actor_type="USER",
                actor_id="curator_b",
                correlation_id="key-b",
                idempotency_key="task.complete:key-b",
            )

    async with factory() as db:
        task = (
            await db.execute(select(task_table).where(task_table.c.id == "task_1"))
        ).mappings().one()
        activities = (
            await db.execute(select(func.count()).select_from(activity_table))
        ).scalar_one()
        outbox = (
            await db.execute(select(func.count()).select_from(outbox_event_table))
        ).scalar_one()
        outbox_key = (
            await db.execute(select(outbox_event_table.c.idempotencyKey))
        ).scalar_one()
    assert task.status == "DONE"
    assert activities == 1
    assert outbox == 1
    assert outbox_key == "task:complete:task_1"
    await engine.dispose()
