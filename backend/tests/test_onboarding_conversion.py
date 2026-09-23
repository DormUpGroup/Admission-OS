from datetime import UTC, datetime

import pytest
from sqlalchemy import insert, select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.db.tables import (
    approval_request_table,
    intake_cohort_table,
    lead_table,
    metadata,
    student_table,
)
from app.services.commands.onboarding import convert_lead_to_student


async def _database():
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    async with engine.begin() as connection:
        await connection.run_sync(metadata.create_all)
    return engine, async_sessionmaker(engine, expire_on_commit=False)


def _qualification(*, intake: str) -> dict[str, str]:
    return {
        "country": "IT",
        "study_level": "BACHELOR",
        "intake": intake,
        "target_field": "CS",
    }


async def _seed_student(
    db,
    *,
    student_id: str,
    intake: str,
    email: str,
    now: datetime,
    accompaniment_status: str = "ACCEPTED",
) -> None:
    await db.execute(
        insert(student_table).values(
            id=student_id,
            firstName="Ada",
            lastName="Lovelace",
            email=email,
            status="ACTIVE",
            journeyStage="PROFILE",
            riskLevel="NONE",
            intake=intake,
            studyLevel="BACHELOR",
            accompanimentStatus=accompaniment_status,
            version=1,
            createdAt=now,
            updatedAt=now,
        )
    )


async def _seed_conversion(
    db,
    *,
    lead_id: str,
    approval_id: str,
    intake: str,
    now: datetime,
    converted_student_id: str | None = None,
) -> None:
    await db.execute(
        insert(lead_table).values(
            id=lead_id,
            firstName="Lead",
            lastName="Student",
            email=f"{lead_id}@example.test",
            status="QUALIFIED" if converted_student_id is None else "CONVERTED",
            source="TELEGRAM",
            consentStatus="GRANTED",
            qualificationJson=_qualification(intake=intake),
            convertedStudentId=converted_student_id,
            createdAt=now,
            updatedAt=now,
        )
    )
    await db.execute(
        insert(approval_request_table).values(
            id=approval_id,
            action="lead.convert",
            riskClass="HIGH",
            status="APPROVED",
            subjectType="Lead",
            subjectId=lead_id,
            proposedJson={"lead_id": lead_id},
            createdAt=now,
            updatedAt=now,
        )
    )


async def _seed_cohort(db, *, intake: str, seat_limit: int, now: datetime) -> None:
    await db.execute(
        insert(intake_cohort_table).values(
            id=f"cohort_{intake}",
            intake=intake,
            seatLimit=seat_limit,
            isActive=True,
            createdAt=now,
            updatedAt=now,
        )
    )


async def test_exact_intake_full_cohort_raises_english_capacity_error() -> None:
    engine, factory = await _database()
    now = datetime.now(UTC)
    async with factory() as db:
        await _seed_cohort(db, intake="2027/28", seat_limit=1, now=now)
        await _seed_student(
            db,
            student_id="student_seat_1",
            intake="2027/28",
            email="seat1@example.test",
            now=now,
        )
        await _seed_conversion(
            db,
            lead_id="lead_full",
            approval_id="approval_full",
            intake="2027/28",
            now=now,
        )
        await db.commit()

    async with factory() as db:
        async with db.begin():
            with pytest.raises(ValueError, match="Intake cohort capacity is exhausted"):
                await convert_lead_to_student(
                    db,
                    lead_id="lead_full",
                    approval_id="approval_full",
                    idempotency_key="convert-full",
                )
    await engine.dispose()


async def test_exact_intake_under_limit_converts() -> None:
    engine, factory = await _database()
    now = datetime.now(UTC)
    async with factory() as db:
        await _seed_cohort(db, intake="2027/28", seat_limit=2, now=now)
        await _seed_student(
            db,
            student_id="student_seat_1",
            intake="2027/28",
            email="seat1@example.test",
            now=now,
        )
        await _seed_conversion(
            db,
            lead_id="lead_ok",
            approval_id="approval_ok",
            intake="2027/28",
            now=now,
        )
        await db.commit()

    async with factory() as db:
        async with db.begin():
            result = await convert_lead_to_student(
                db,
                lead_id="lead_ok",
                approval_id="approval_ok",
                idempotency_key="convert-ok",
            )
    assert result["lead_id"] == "lead_ok"
    assert result["status"] == "CONVERTED"
    assert result["student_id"]
    async with factory() as db:
        student = (
            await db.execute(
                select(student_table).where(student_table.c.id == result["student_id"])
            )
        ).mappings().one()
    assert student.accompanimentStatus == "ACCEPTED"
    await engine.dispose()


async def test_already_converted_lead_short_circuits() -> None:
    engine, factory = await _database()
    now = datetime.now(UTC)
    async with factory() as db:
        await _seed_student(
            db,
            student_id="student_existing",
            intake="2027/28",
            email="existing@example.test",
            now=now,
        )
        await _seed_conversion(
            db,
            lead_id="lead_done",
            approval_id="approval_done",
            intake="2027/28",
            now=now,
            converted_student_id="student_existing",
        )
        await db.commit()

    async with factory() as db:
        async with db.begin():
            result = await convert_lead_to_student(
                db,
                lead_id="lead_done",
                approval_id="approval_done",
                idempotency_key="convert-done",
            )
    assert result == {
        "lead_id": "lead_done",
        "student_id": "student_existing",
        "status": "ALREADY_CONVERTED",
    }
    await engine.dispose()


async def test_alias_intake_full_cohort_blocks_conversion() -> None:
    engine, factory = await _database()
    now = datetime.now(UTC)
    async with factory() as db:
        await _seed_cohort(db, intake="2027/28", seat_limit=1, now=now)
        await _seed_student(
            db,
            student_id="student_seat_1",
            intake="2027/28",
            email="seat1@example.test",
            now=now,
        )
        await _seed_conversion(
            db,
            lead_id="lead_alias_full",
            approval_id="approval_alias_full",
            intake="2027/2028",
            now=now,
        )
        await db.commit()

    async with factory() as db:
        async with db.begin():
            with pytest.raises(ValueError, match="Intake cohort capacity is exhausted"):
                await convert_lead_to_student(
                    db,
                    lead_id="lead_alias_full",
                    approval_id="approval_alias_full",
                    idempotency_key="convert-alias-full",
                )
    await engine.dispose()


async def test_alias_intake_under_limit_converts() -> None:
    engine, factory = await _database()
    now = datetime.now(UTC)
    async with factory() as db:
        await _seed_cohort(db, intake="2027/28", seat_limit=2, now=now)
        await _seed_student(
            db,
            student_id="student_seat_1",
            intake="2027/28",
            email="seat1@example.test",
            now=now,
        )
        await _seed_conversion(
            db,
            lead_id="lead_alias_ok",
            approval_id="approval_alias_ok",
            intake="2027/2028",
            now=now,
        )
        await db.commit()

    async with factory() as db:
        async with db.begin():
            result = await convert_lead_to_student(
                db,
                lead_id="lead_alias_ok",
                approval_id="approval_alias_ok",
                idempotency_key="convert-alias-ok",
            )
    assert result["lead_id"] == "lead_alias_ok"
    assert result["status"] == "CONVERTED"
    assert result["student_id"]
    await engine.dispose()
