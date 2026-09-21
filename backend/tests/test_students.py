import asyncio
from collections.abc import Iterator
from datetime import UTC, datetime, timedelta
from types import SimpleNamespace

import jwt
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import insert
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.api.students import to_student_summary
from app.core.config import get_settings
from app.db.session import get_db_session
from app.db.tables import (
    application_table,
    document_table,
    metadata,
    program_table,
    student_table,
    university_table,
    user_table,
)
from app.main import app

TEST_SECRET = "test-secret-that-is-longer-than-thirty-two-bytes"


def _list_query_row(**overrides: object) -> SimpleNamespace:
    data = {
        "id": "student_1",
        "firstName": "Alina",
        "lastName": "Sokolova",
        "email": "alina@example.test",
        "status": "ACTIVE",
        "journeyStage": "APPLICATIONS",
        "riskLevel": "LOW",
        "intake": "2027/28",
        "targetField": "Computer Science",
        "preferredLanguage": "en",
        "curatorId": "curator_1",
        "curator_name": "Anna",
        "studyLevel": "BACHELOR",
        "country": "IT",
        "nextActionJson": None,
        "application_count": 2,
        "document_count": 4,
        "approved_document_count": 1,
    }
    data.update(overrides)
    return SimpleNamespace(**data)


def test_student_summary_maps_the_list_query_shape() -> None:
    summary = to_student_summary(_list_query_row())

    assert summary.id == "student_1"
    assert summary.curator_name == "Anna"
    assert summary.application_count == 2
    assert summary.document_count == 4
    assert summary.approved_document_count == 1


def test_student_summary_cannot_map_a_student_table_only_row() -> None:
    data = _list_query_row().__dict__.copy()
    for field in (
        "curator_name",
        "application_count",
        "document_count",
        "approved_document_count",
    ):
        data.pop(field)

    with pytest.raises(AttributeError):
        to_student_summary(SimpleNamespace(**data))


def _staff_token(user_id: str, role: str = "CURATOR") -> str:
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
def student_client(monkeypatch: pytest.MonkeyPatch) -> Iterator[TestClient]:
    monkeypatch.setenv("INTERNAL_API_SECRET", TEST_SECRET)
    get_settings.cache_clear()

    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    factory = async_sessionmaker(engine, expire_on_commit=False)
    now = datetime.now(UTC)

    async def seed() -> None:
        async with engine.begin() as conn:
            await conn.run_sync(metadata.create_all)
        async with factory() as db:
            await db.execute(insert(user_table).values(id="curator_1", name="Anna", role="CURATOR"))
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
                    targetField="Computer Science",
                    preferredLanguage="en",
                    studyLevel="BACHELOR",
                    country="IT",
                )
            )
            await db.execute(
                insert(student_table).values(
                    id="student_other",
                    firstName="Boris",
                    lastName="Ivanov",
                    email="boris@example.test",
                    curatorId="curator_other",
                    status="ACTIVE",
                    journeyStage="PROFILE",
                    riskLevel="NONE",
                    intake="2027/28",
                    studyLevel="BACHELOR",
                    country="IT",
                )
            )
            await db.execute(
                insert(application_table).values(
                    id="app_1",
                    studentId="student_1",
                    programId="prog_1",
                    status="PREPARING",
                    intake="2027/28",
                    readinessPercent=0,
                    riskLevel="LOW",
                    applicationFeePaid=False,
                    createdAt=now,
                    updatedAt=now,
                )
            )
            await db.execute(
                insert(document_table).values(
                    id="doc_approved",
                    studentId="student_1",
                    name="Passport",
                    category="IDENTITY",
                    status="APPROVED",
                    createdAt=now,
                    updatedAt=now,
                )
            )
            await db.execute(
                insert(document_table).values(
                    id="doc_missing",
                    studentId="student_1",
                    name="Diploma",
                    category="EDUCATION",
                    status="MISSING",
                    createdAt=now,
                    updatedAt=now,
                )
            )
            await db.commit()

    asyncio.run(seed())

    async def override_db():
        async with factory() as session:
            yield session

    app.dependency_overrides[get_db_session] = override_db
    try:
        with TestClient(app) as client:
            yield client
    finally:
        app.dependency_overrides.pop(get_db_session, None)
        get_settings.cache_clear()
        asyncio.run(engine.dispose())


def test_list_students_returns_summary_counts_for_assigned_caseload(
    student_client: TestClient,
) -> None:
    response = student_client.get(
        "/v1/students",
        headers={"Authorization": f"Bearer {_staff_token('curator_1')}"},
    )

    assert response.status_code == 200
    payload = response.json()
    assert [row["id"] for row in payload] == ["student_1"]
    assert payload[0]["curator_name"] == "Anna"
    assert payload[0]["application_count"] == 1
    assert payload[0]["document_count"] == 2
    assert payload[0]["approved_document_count"] == 1


def test_get_student_returns_the_same_summary_as_the_list(student_client: TestClient) -> None:
    headers = {"Authorization": f"Bearer {_staff_token('curator_1')}"}
    listed = student_client.get("/v1/students", headers=headers)
    detail = student_client.get("/v1/students/student_1", headers=headers)

    assert listed.status_code == 200
    assert detail.status_code == 200
    assert detail.json() == listed.json()[0]


def test_get_student_hides_another_curators_caseload(student_client: TestClient) -> None:
    response = student_client.get(
        "/v1/students/student_other",
        headers={"Authorization": f"Bearer {_staff_token('curator_1')}"},
    )

    assert response.status_code == 404
    assert response.json() == {"detail": "Student not found"}
