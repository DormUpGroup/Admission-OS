from collections.abc import Iterator
from datetime import UTC, datetime, timedelta

import jwt
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import insert
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.core.config import get_settings
from app.db.session import get_db_session
from app.db.tables import (
    metadata,
    program_academic_year_table,
    program_fact_table,
    program_match_table,
    program_table,
    student_table,
    university_table,
    user_table,
)
from app.main import app

TEST_SECRET = "test-secret-that-is-longer-than-thirty-two-bytes"


def _staff_token(user_id: str = "curator_1", role: str = "CURATOR") -> str:
    return jwt.encode(
        {
            "sub": user_id,
            "email": f"{user_id}@example.test",
            "role": role,
            "iss": "immigrome-nextjs",
            "aud": "immigrome-python-api",
            "exp": datetime.now(UTC) + timedelta(minutes=1),
        },
        TEST_SECRET,
        algorithm="HS256",
    )


@pytest.fixture
def catalog_client(monkeypatch: pytest.MonkeyPatch) -> Iterator[TestClient]:
    monkeypatch.setenv("INTERNAL_API_SECRET", TEST_SECRET)
    get_settings.cache_clear()

    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    factory = async_sessionmaker(engine, expire_on_commit=False)
    now = datetime.now(UTC)

    async def seed() -> None:
        async with engine.begin() as conn:
            await conn.run_sync(metadata.create_all)
        async with factory() as db:
            await db.execute(
                insert(user_table).values(id="curator_1", name="Anna", role="CURATOR")
            )
            await db.execute(
                insert(user_table).values(id="admin_1", name="Admin", role="ADMIN")
            )
            await db.execute(
                insert(university_table).values(
                    id="uni_1",
                    name="Politecnico",
                    slug="polimi",
                    city="Milan",
                    region="Lombardy",
                    country="IT",
                    publicPrivate="PUBLIC",
                    website=None,
                    createdAt=now,
                    updatedAt=now,
                )
            )
            await db.execute(
                insert(program_table).values(
                    id="prog_1",
                    universityId="uni_1",
                    name="Computer Science",
                    slug="cs",
                    degreeLevel="BACHELOR",
                    field="CS",
                    language="en",
                    active=True,
                    officialUrl="https://www.polimi.it/cs",
                    createdAt=now,
                    updatedAt=now,
                )
            )
            await db.execute(
                insert(program_academic_year_table).values(
                    id="pay_1",
                    programId="prog_1",
                    academicYear="2026/27",
                )
            )
            await db.execute(
                insert(student_table).values(
                    id="student_1",
                    firstName="Alina",
                    lastName="Sokolova",
                    email="alina@example.test",
                    curatorId="curator_1",
                    status="ACTIVE",
                    journeyStage="APPLICATIONS",
                    riskLevel="LOW",
                    intake="2027/28",
                    studyLevel="BACHELOR",
                    country="IT",
                )
            )
            await db.execute(
                insert(program_match_table).values(
                    id="match_1",
                    studentId="student_1",
                    programAcademicYearId="pay_1",
                    eligibilityStatus="ELIGIBLE",
                    fitScore=80,
                    dataConfidence="MEDIUM",
                    generatedAt=now,
                    matchingEngineVersion="test",
                    curatorStatus="AUTO_MATCHED",
                    monitoringSelected=False,
                    createdAt=now,
                    updatedAt=now,
                )
            )
            await db.execute(
                insert(program_fact_table).values(
                    id="fact_source",
                    programId="prog_1",
                    programAcademicYearId="pay_1",
                    field="PROGRAMME_SOURCE_RESOLUTION",
                    normalizedValueJson='{"url":"https://www.polimi.it/cs"}',
                    evidenceQuote="CS page",
                    freshness="CURRENT",
                    origin="OFFICIAL_FALLBACK",
                    decisionStatus="ELIGIBLE",
                    sourceUrl="https://www.polimi.it/cs",
                    sourceType="PROGRAMME_PAGE",
                    retrievedAt=now,
                    confidence="HIGH",
                    extractionMethod="SOURCE_RESOLVER",
                    verificationStatus="VERIFIED",
                    superseded=False,
                )
            )
            await db.execute(
                insert(program_fact_table).values(
                    id="fact_deadline",
                    programId="prog_1",
                    programAcademicYearId="pay_1",
                    field="APPLICATION_DEADLINE",
                    normalizedValueJson='{"date":"2026-06-01"}',
                    evidenceQuote="Deadline June",
                    freshness="CURRENT",
                    origin="OFFICIAL_FALLBACK",
                    decisionStatus="ELIGIBLE",
                    sourceUrl="https://www.polimi.it/cs",
                    sourceType="ADMISSION_CALL",
                    retrievedAt=now,
                    confidence="HIGH",
                    extractionMethod="HTML",
                    verificationStatus="VERIFIED",
                    superseded=False,
                )
            )
            await db.commit()

    import asyncio

    asyncio.run(seed())

    async def override_db():
        async with factory() as session:
            yield session

    app.dependency_overrides[get_db_session] = override_db
    with TestClient(app) as client:
        yield client
    app.dependency_overrides.clear()
    get_settings.cache_clear()


def test_create_university_requires_idempotency_key(catalog_client: TestClient) -> None:
    response = catalog_client.post(
        "/v1/universities",
        headers={"Authorization": f"Bearer {_staff_token()}"},
        json={"name": "Bocconi"},
    )
    assert response.status_code == 400
    assert "Idempotency-Key" in response.json()["detail"]


def test_create_university_command(catalog_client: TestClient) -> None:
    response = catalog_client.post(
        "/v1/universities",
        headers={
            "Authorization": f"Bearer {_staff_token()}",
            "Idempotency-Key": "uni-create-0001",
        },
        json={"name": "Bocconi", "city": "Milan"},
    )
    assert response.status_code == 201
    assert "id" in response.json()


def test_reset_universitaly_cache_admin_only(catalog_client: TestClient) -> None:
    forbidden = catalog_client.post(
        "/v1/catalog/universitaly-cache/reset",
        headers={
            "Authorization": f"Bearer {_staff_token()}",
            "Idempotency-Key": "cache-reset-0001",
        },
    )
    assert forbidden.status_code == 403

    allowed = catalog_client.post(
        "/v1/catalog/universitaly-cache/reset",
        headers={
            "Authorization": f"Bearer {_staff_token('admin_1', 'ADMIN')}",
            "Idempotency-Key": "cache-reset-0002",
        },
    )
    assert allowed.status_code == 200
    body = allowed.json()
    assert body["status"] == "queued"
    assert body["outbox_event_id"]


def test_review_shortlist_and_monitoring(catalog_client: TestClient) -> None:
    review = catalog_client.post(
        "/v1/program-matches/review",
        headers={
            "Authorization": f"Bearer {_staff_token()}",
            "Idempotency-Key": "match-review-0001",
        },
        json={
            "student_id": "student_1",
            "match_id": "match_1",
            "status": "SHORTLISTED",
        },
    )
    assert review.status_code == 200
    assert review.json()["status"] == "SHORTLISTED"

    monitor = catalog_client.post(
        "/v1/program-matches/monitoring-selected",
        headers={
            "Authorization": f"Bearer {_staff_token()}",
            "Idempotency-Key": "monitor-0001",
        },
        json={
            "student_id": "student_1",
            "match_id": "match_1",
            "selected": True,
        },
    )
    assert monitor.status_code == 200
    assert monitor.json()["selected"] is True


def test_reset_program_matches(catalog_client: TestClient) -> None:
    response = catalog_client.post(
        "/v1/students/student_1/program-matches/reset",
        headers={
            "Authorization": f"Bearer {_staff_token()}",
            "Idempotency-Key": "match-reset-0001",
        },
    )
    assert response.status_code == 200
    assert response.json()["matches_deleted"] >= 1


def test_dismiss_work_queue_item(catalog_client: TestClient) -> None:
    response = catalog_client.post(
        "/v1/work-queue/dismiss",
        headers={
            "Authorization": f"Bearer {_staff_token()}",
            "Idempotency-Key": "queue-dismiss-0001",
        },
        json={"student_id": "student_1", "source_key": "risk:student_1"},
    )
    assert response.status_code == 200
    assert "id" in response.json()


def test_recalculate_requires_idempotency_and_uses_command(
    catalog_client: TestClient,
) -> None:
    missing = catalog_client.post(
        "/v1/students/student_1/recalculate",
        headers={"Authorization": f"Bearer {_staff_token()}"},
    )
    assert missing.status_code == 400
    assert "Idempotency-Key" in missing.json()["detail"]

    ok = catalog_client.post(
        "/v1/students/student_1/recalculate",
        headers={
            "Authorization": f"Bearer {_staff_token()}",
            "Idempotency-Key": "recalc-0001",
        },
    )
    assert ok.status_code == 200
