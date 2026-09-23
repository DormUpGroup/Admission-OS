from datetime import UTC, datetime, timedelta

from sqlalchemy import insert, select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.db.tables import metadata, outbox_event_table
from app.events.outbox import claim_events, dispatch_claimed_event, mark_processed


async def _database():
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    async with engine.begin() as connection:
        await connection.run_sync(metadata.create_all)
    return engine, async_sessionmaker(engine, expire_on_commit=False)


async def test_outbox_claim_and_process_is_durable() -> None:
    engine, factory = await _database()
    now = datetime.now(UTC)
    async with factory() as db:
        await db.execute(
            insert(outbox_event_table).values(
                id="event_1",
                aggregateType="Task",
                aggregateId="task_1",
                eventType="task.created.v1",
                eventVersion=1,
                payloadJson={"task_id": "task_1"},
                status="PENDING",
                attempts=0,
                maxAttempts=3,
                nextAttemptAt=now,
                idempotencyKey="task_1_created",
                createdAt=now,
                updatedAt=now,
            )
        )
        await db.commit()

    called: list[str] = []

    async def handler(_, event):
        called.append(event["id"])

    async with factory() as db:
        async with db.begin():
            events = await claim_events(db, worker_id="worker-1", now=now)
    assert [event["id"] for event in events] == ["event_1"]

    async with factory() as db:
        async with db.begin():
            result = await dispatch_claimed_event(
                db, events[0], {"task.created.v1": handler}
            )
    assert result == "PROCESSED"
    assert called == ["event_1"]

    async with factory() as db:
        row = (
            await db.execute(
                select(outbox_event_table).where(outbox_event_table.c.id == "event_1")
            )
        ).mappings().one()
    assert row.status == "PROCESSED"
    assert row.processedAt is not None
    await engine.dispose()


async def test_outbox_failure_returns_to_pending_with_backoff() -> None:
    engine, factory = await _database()
    now = datetime.now(UTC)
    async with factory() as db:
        await db.execute(
            insert(outbox_event_table).values(
                id="event_2",
                aggregateType="Conversation",
                aggregateId="conversation_1",
                eventType="message.received.v1",
                eventVersion=1,
                payloadJson={},
                status="PENDING",
                attempts=0,
                maxAttempts=3,
                nextAttemptAt=now,
                idempotencyKey="telegram_1",
                createdAt=now,
                updatedAt=now,
            )
        )
        await db.commit()
    async with factory() as db:
        async with db.begin():
            events = await claim_events(db, worker_id="worker-1", now=now)
    async with factory() as db:
        async with db.begin():
            result = await dispatch_claimed_event(db, events[0], {})
    assert result == "FAILED"
    async with factory() as db:
        row = (
            await db.execute(
                select(outbox_event_table).where(outbox_event_table.c.id == "event_2")
            )
        ).mappings().one()
    assert row.status == "PENDING"
    assert row.attempts == 1
    assert row.nextAttemptAt.replace(tzinfo=UTC) > now
    await engine.dispose()


async def test_outbox_exhaustion_moves_event_to_dead_letter() -> None:
    engine, factory = await _database()
    now = datetime.now(UTC)
    async with factory() as db:
        await db.execute(
            insert(outbox_event_table).values(
                id="event_dead",
                aggregateType="Conversation",
                aggregateId="conversation_dead",
                eventType="unsupported.v1",
                eventVersion=1,
                payloadJson={},
                status="PENDING",
                attempts=2,
                maxAttempts=3,
                nextAttemptAt=now,
                idempotencyKey="dead_1",
                createdAt=now,
                updatedAt=now,
            )
        )
        await db.commit()
    async with factory() as db:
        async with db.begin():
            events = await claim_events(db, worker_id="worker-1", now=now)
    async with factory() as db:
        async with db.begin():
            await dispatch_claimed_event(db, events[0], {})
    async with factory() as db:
        status = (
            await db.execute(
                select(outbox_event_table.c.status).where(
                    outbox_event_table.c.id == "event_dead"
                )
            )
        ).scalar_one()
    assert status == "DEAD"
    await engine.dispose()


async def test_stale_worker_cannot_finalize_after_reclaim() -> None:
    engine, factory = await _database()
    now = datetime.now(UTC)
    async with factory() as db:
        await db.execute(
            insert(outbox_event_table).values(
                id="event_lease",
                aggregateType="Task",
                aggregateId="task_lease",
                eventType="task.created.v1",
                eventVersion=1,
                payloadJson={"task_id": "task_lease"},
                status="PENDING",
                attempts=0,
                maxAttempts=3,
                nextAttemptAt=now,
                idempotencyKey="lease_1",
                createdAt=now,
                updatedAt=now,
            )
        )
        await db.commit()

    async with factory() as db:
        async with db.begin():
            first = await claim_events(db, worker_id="worker-old", now=now)
    assert len(first) == 1
    stale_token = first[0]["leaseToken"]

    expired = first[0]["leaseExpiresAt"]
    async with factory() as db:
        async with db.begin():
            second = await claim_events(
                db,
                worker_id="worker-new",
                now=expired + timedelta(seconds=1),
            )
    assert len(second) == 1
    assert second[0]["leaseToken"] != stale_token

    async with factory() as db:
        async with db.begin():
            assert not await mark_processed(
                db, "event_lease", lease_token=stale_token
            )

    async with factory() as db:
        async with db.begin():
            assert await mark_processed(
                db, "event_lease", lease_token=second[0]["leaseToken"]
            )

    async with factory() as db:
        row = (
            await db.execute(
                select(outbox_event_table).where(
                    outbox_event_table.c.id == "event_lease"
                )
            )
        ).mappings().one()
    assert row.status == "PROCESSED"
    assert row.leaseToken is None
    await engine.dispose()
