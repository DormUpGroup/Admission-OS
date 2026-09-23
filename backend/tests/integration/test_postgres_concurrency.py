"""Postgres-backed concurrency and lease integration tests.

Skipped unless DATABASE_URL points at PostgreSQL (CI sets this).
"""

from __future__ import annotations

import asyncio
import os
from datetime import UTC, datetime, timedelta
from uuid import uuid4

import pytest
from fastapi import HTTPException
from sqlalchemy import func, insert, select, text
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.db.session import _async_database_url
from app.db.tables import (
    conversation_message_table,
    conversation_table,
    intake_cohort_table,
    lead_table,
    metadata,
    outbox_event_table,
    student_table,
    task_table,
    user_table,
)
from app.events.outbox import claim_events, mark_processed
from app.mcp.tools import lead_update_qualification
from app.schemas.messages import SendMessageRequest
from app.services.commands.accompaniment import accept_accompaniment_command
from app.services.commands.base import CommandResult, execute_command, user_context
from app.services.commands.messages import send_portal_message_command
from app.services.commands.tasks import complete_task_command

pytestmark = pytest.mark.postgres


def _database_url() -> str | None:
    url = os.environ.get("DATABASE_URL") or os.environ.get(
        "SCHEMA_CONTRACT_DATABASE_URL"
    )
    if not url or "sqlite" in url:
        return None
    if not url.startswith(("postgresql", "postgres")):
        return None
    return url


@pytest.fixture
async def pg_engine():
    url = _database_url()
    if url is None:
        pytest.skip("PostgreSQL DATABASE_URL is not configured")
    engine = create_async_engine(_async_database_url(url), pool_size=5, max_overflow=0)
    schema = f"itest_{uuid4().hex[:12]}"
    async with engine.begin() as connection:
        await connection.execute(text(f'CREATE SCHEMA "{schema}"'))
        await connection.execute(text(f'SET search_path TO "{schema}"'))
        await connection.run_sync(metadata.create_all)
        await connection.execute(
            text(
                """
                CREATE UNIQUE INDEX IF NOT EXISTS "Conversation_one_open_portal_student_key"
                  ON "Conversation" ("studentId")
                  WHERE "channel" = 'PORTAL' AND "status" = 'OPEN' AND "studentId" IS NOT NULL
                """
            )
        )

    factory = async_sessionmaker(engine, expire_on_commit=False)

    class SessionFactory:
        async def begin_session(self):
            session = factory()
            await session.execute(text(f'SET search_path TO "{schema}"'))
            return session

    yield SessionFactory()
    async with engine.begin() as connection:
        await connection.execute(text(f'DROP SCHEMA IF EXISTS "{schema}" CASCADE'))
    await engine.dispose()


async def test_stale_outbox_lease_cannot_finalize(pg_engine) -> None:
    now = datetime.now(UTC)
    async with await pg_engine.begin_session() as db:
        async with db.begin():
            await db.execute(
                insert(outbox_event_table).values(
                    id="event_lease",
                    aggregateType="Task",
                    aggregateId="task_1",
                    eventType="task.created.v1",
                    eventVersion=1,
                    payloadJson={},
                    status="PENDING",
                    attempts=0,
                    maxAttempts=3,
                    nextAttemptAt=now,
                    idempotencyKey=f"lease-{uuid4().hex}",
                    createdAt=now,
                    updatedAt=now,
                )
            )
    async with await pg_engine.begin_session() as db:
        async with db.begin():
            first = await claim_events(db, worker_id="old", now=now)
    assert len(first) == 1
    stale = first[0]["leaseToken"]
    async with await pg_engine.begin_session() as db:
        async with db.begin():
            second = await claim_events(
                db,
                worker_id="new",
                now=first[0]["leaseExpiresAt"] + timedelta(seconds=1),
            )
    assert second[0]["leaseToken"] != stale
    async with await pg_engine.begin_session() as db:
        async with db.begin():
            assert not await mark_processed(db, "event_lease", lease_token=stale)
            assert await mark_processed(
                db, "event_lease", lease_token=second[0]["leaseToken"]
            )


async def test_mcp_same_key_different_payload_conflicts(pg_engine) -> None:
    now = datetime.now(UTC)
    key = f"mcp-conflict-{uuid4().hex}"
    async with await pg_engine.begin_session() as db:
        async with db.begin():
            await db.execute(
                insert(lead_table).values(
                    id="lead_1",
                    status="QUALIFYING",
                    source="TELEGRAM",
                    consentStatus="GRANTED",
                    createdAt=now,
                    updatedAt=now,
                )
            )
    async with await pg_engine.begin_session() as db:
        async with db.begin():
            await lead_update_qualification(
                db,
                {
                    "lead_id": "lead_1",
                    "fields": {"country": "IT"},
                    "idempotency_key": key,
                    "agent_key": "intake",
                },
            )
    async with await pg_engine.begin_session() as db:
        with pytest.raises(ValueError, match="different request payload"):
            async with db.begin():
                await lead_update_qualification(
                    db,
                    {
                        "lead_id": "lead_1",
                        "fields": {"country": "FR"},
                        "idempotency_key": key,
                        "agent_key": "intake",
                    },
                )


async def test_concurrent_portal_conversation_create(pg_engine) -> None:
    now = datetime.now(UTC)
    async with await pg_engine.begin_session() as db:
        async with db.begin():
            await db.execute(
                insert(user_table).values(
                    id="curator_1", name="Curator", role="CURATOR"
                )
            )
            await db.execute(
                insert(student_table).values(
                    id="student_1",
                    firstName="A",
                    lastName="B",
                    email=f"a-{uuid4().hex}@example.com",
                    studyLevel="BACHELOR",
                    intake="2027/28",
                    status="ACTIVE",
                    journeyStage="PROFILE",
                    riskLevel="NONE",
                    accompanimentStatus="NONE",
                    version=1,
                    createdAt=now,
                    updatedAt=now,
                )
            )

    async def send_once(key: str) -> None:
        async with await pg_engine.begin_session() as db:
            async with db.begin():
                await send_portal_message_command(
                    db,
                    context=user_context(
                        user_id="student_1",
                        operation="message.student.send",
                        idempotency_key=key,
                    ),
                    request=SendMessageRequest(text=f"hello {key}"),
                    student_id="student_1",
                    curator_id="curator_1",
                    from_student=True,
                    author="Student",
                )

    await asyncio.gather(
        send_once(f"msg-a-{uuid4().hex}"),
        send_once(f"msg-b-{uuid4().hex}"),
    )
    async with await pg_engine.begin_session() as db:
        conversations = (
            await db.execute(
                select(func.count())
                .select_from(conversation_table)
                .where(
                    conversation_table.c.studentId == "student_1",
                    conversation_table.c.channel == "PORTAL",
                )
            )
        ).scalar_one()
        messages = (
            await db.execute(
                select(func.count()).select_from(conversation_message_table)
            )
        ).scalar_one()
    assert conversations == 1
    assert messages == 2


async def test_capacity_last_seat_one_success(pg_engine) -> None:
    now = datetime.now(UTC)
    async with await pg_engine.begin_session() as db:
        async with db.begin():
            await db.execute(
                insert(user_table).values(
                    id="curator_1", name="Curator", role="CURATOR"
                )
            )
            await db.execute(
                insert(intake_cohort_table).values(
                    id="cohort_1",
                    intake="2027/28",
                    seatLimit=1,
                    isActive=True,
                    version=1,
                    createdAt=now,
                    updatedAt=now,
                )
            )
            for idx in (1, 2):
                await db.execute(
                    insert(student_table).values(
                        id=f"student_{idx}",
                        firstName=f"S{idx}",
                        lastName="X",
                        email=f"s{idx}-{uuid4().hex}@example.com",
                        studyLevel="BACHELOR",
                        intake="2027/28",
                        status="ACTIVE",
                        journeyStage="PROFILE",
                        riskLevel="NONE",
                        accompanimentStatus="NONE",
                        version=1,
                        createdAt=now,
                        updatedAt=now,
                    )
                )

    results: list[str] = []

    async def accept(student_id: str, key: str) -> None:
        try:
            async with await pg_engine.begin_session() as db:
                async with db.begin():
                    await accept_accompaniment_command(
                        db,
                        context=user_context(
                            user_id="curator_1",
                            operation="accompaniment.accept",
                            idempotency_key=key,
                        ),
                        student_id=student_id,
                    )
            results.append("ok")
        except HTTPException:
            results.append("conflict")
        except Exception:
            results.append("error")

    await asyncio.gather(
        accept("student_1", f"accept-1-{uuid4().hex}"),
        accept("student_2", f"accept-2-{uuid4().hex}"),
    )
    assert results.count("ok") == 1
    assert results.count("conflict") == 1


async def test_concurrent_task_completion(pg_engine) -> None:
    now = datetime.now(UTC)
    async with await pg_engine.begin_session() as db:
        async with db.begin():
            await db.execute(
                insert(user_table).values(
                    id="curator_1", name="Curator", role="CURATOR"
                )
            )
            await db.execute(
                insert(student_table).values(
                    id="student_task",
                    firstName="T",
                    lastName="Ask",
                    email=f"task-{uuid4().hex}@example.com",
                    studyLevel="BACHELOR",
                    intake="2027/28",
                    status="ACTIVE",
                    journeyStage="PROFILE",
                    riskLevel="NONE",
                    accompanimentStatus="NONE",
                    version=1,
                    createdAt=now,
                    updatedAt=now,
                )
            )
            await db.execute(
                insert(task_table).values(
                    id="task_1",
                    title="Do it",
                    status="TODO",
                    priority="MEDIUM",
                    studentId="student_task",
                    isStudentFacing=False,
                    createdAt=now,
                    updatedAt=now,
                )
            )

    async def complete(key: str) -> None:
        async with await pg_engine.begin_session() as db:
            async with db.begin():

                async def handler(context):
                    await complete_task_command(
                        db,
                        task_id="task_1",
                        actor_type=context.actor_type,
                        actor_id=context.actor_id,
                        correlation_id=context.correlation_id,
                        idempotency_key=context.idempotency_key,
                    )
                    return CommandResult(
                        response={"id": "task_1", "status": "DONE"},
                        entity_type="Task",
                        entity_id="task_1",
                    )

                await execute_command(
                    db,
                    context=user_context(
                        user_id="curator_1",
                        operation="task.complete",
                        idempotency_key=key,
                    ),
                    payload={"task_id": "task_1"},
                    handler=handler,
                )

    await asyncio.gather(
        complete(f"complete-a-{uuid4().hex}"),
        complete(f"complete-b-{uuid4().hex}"),
    )
    async with await pg_engine.begin_session() as db:
        status = (
            await db.execute(
                select(task_table.c.status).where(task_table.c.id == "task_1")
            )
        ).scalar_one()
    assert status == "DONE"
