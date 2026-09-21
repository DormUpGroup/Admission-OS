"""Run destructive Python API smoke checks against a disposable database fixture.

The script creates a uniquely prefixed curator, student and related records,
exercises the bridge endpoints over HTTP, then removes every record it created.
It never selects or mutates production student data.
"""

import argparse
import asyncio
from datetime import UTC, datetime, timedelta
from uuid import uuid4

import httpx
import jwt
from sqlalchemy import text

from app.core.config import get_settings
from app.db.session import get_engine


def actor_token(user_id: str, email: str, role: str) -> str:
    secret = get_settings().bridge_secret
    if not secret:
        raise RuntimeError("Bridge secret is not configured")
    return jwt.encode(
        {
            "sub": user_id,
            "email": email,
            "role": role,
            "iss": "immigrome-nextjs",
            "aud": "immigrome-python-api",
            "exp": datetime.now(UTC) + timedelta(minutes=5),
        },
        secret,
        algorithm="HS256",
    )


async def run(base_url: str) -> None:
    marker = f"smoke-{uuid4().hex[:12]}"
    curator_id = f"{marker}-curator"
    student_user_id = f"{marker}-student-user"
    student_id = f"{marker}-student"
    curator_email = f"{marker}-curator@example.test"
    student_email = f"{marker}-student@example.test"
    document_id: str | None = None
    application_id: str | None = None
    notification_id = f"{marker}-notification"
    engine = get_engine()

    async def request(client: httpx.AsyncClient, method: str, path: str, token: str, **kwargs):
        response = await client.request(
            method,
            path,
            headers={"Authorization": f"Bearer {token}"},
            **kwargs,
        )
        response.raise_for_status()
        return response

    try:
        async with engine.begin() as db:
            program_id = await db.scalar(
                text('SELECT "id" FROM "Program" WHERE "active" = true LIMIT 1')
            )
            if not program_id:
                raise RuntimeError("No active Program is available for the smoke fixture")
            # Prisma maps DateTime to PostgreSQL ``timestamp`` (without a
            # timezone).  The disposable bootstrap mirrors that representation.
            now = datetime.now(UTC).replace(tzinfo=None)
            for user_id, email, name, role in (
                (curator_id, curator_email, "Smoke Curator", "CURATOR"),
                (student_user_id, student_email, "Smoke Student", "STUDENT"),
            ):
                await db.execute(
                    text(
                        'INSERT INTO "User" '
                        '("id", "email", "name", "passwordHash", "role", "createdAt", "updatedAt") '
                        "VALUES (:id, :email, :name, :password_hash, :role, :now, :now)"
                    ),
                    {
                        "id": user_id,
                        "email": email,
                        "name": name,
                        "password_hash": "smoke-fixture-not-for-login",
                        "role": role,
                        "now": now,
                    },
                )
            await db.execute(
                text(
                    'INSERT INTO "Student" '
                    '("id", "userId", "firstName", "lastName", "email", "studyLevel", "intake", '
                    '"status", "journeyStage", "curatorId", "riskLevel", "accompanimentStatus", '
                    '"createdAt", "updatedAt") '
                    "VALUES (:id, :user_id, :first_name, :last_name, :email, :study_level, "
                    ":intake, :status, :journey_stage, :curator_id, :risk_level, "
                    ":accompaniment_status, :now, :now)"
                ),
                {
                    "id": student_id,
                    "user_id": student_user_id,
                    "first_name": "Smoke",
                    "last_name": "Student",
                    "email": student_email,
                    "study_level": "BACHELOR",
                    "intake": "2027/28",
                    "status": "ACTIVE",
                    "journey_stage": "DOCUMENTS",
                    "curator_id": curator_id,
                    "risk_level": "NONE",
                    "accompaniment_status": "ACCEPTED",
                    "now": now,
                },
            )
            await db.execute(
                text(
                    'INSERT INTO "InAppNotification" '
                    '("id", "userId", "studentId", "type", "title", "body", "createdAt") '
                    "VALUES (:id, :user_id, :student_id, :type, :title, :body, :now)"
                ),
                {
                    "id": notification_id,
                    "user_id": student_user_id,
                    "student_id": student_id,
                    "type": "SMOKE",
                    "title": "Smoke notification",
                    "body": "Disposable smoke fixture",
                    "now": now,
                },
            )

        curator_token = actor_token(curator_id, curator_email, "CURATOR")
        student_token = actor_token(student_user_id, student_email, "STUDENT")
        async with httpx.AsyncClient(base_url=base_url, timeout=15) as client:
            document = await request(
                client,
                "POST",
                f"/v1/students/{student_id}/documents",
                curator_token,
                json={"student_id": student_id, "name": "Smoke passport", "category": "PERSONAL"},
            )
            document_id = document.json()["id"]
            await request(client, "POST", f"/v1/documents/{document_id}/request", curator_token)

            async with engine.connect() as db:
                task_id = await db.scalar(
                    text(
                        'SELECT "id" FROM "Task" WHERE "documentId" = :document_id '
                        'ORDER BY "createdAt" DESC LIMIT 1'
                    ),
                    {"document_id": document_id},
                )
            if not task_id:
                raise RuntimeError("Document request did not create a student task")
            await request(client, "POST", f"/v1/portal/tasks/{task_id}/complete", student_token)
            upload_body = {
                "storage_path": f"smoke/{marker}/passport.pdf",
                "file_url": f"/api/files/smoke/{marker}/passport.pdf",
            }
            await request(
                client,
                "POST",
                f"/v1/portal/documents/{document_id}/uploaded",
                student_token,
                json=upload_body,
            )
            await request(client, "POST", f"/v1/documents/{document_id}/approve", curator_token)
            await request(
                client,
                "POST",
                f"/v1/documents/{document_id}/needs-changes",
                curator_token,
                json={"reason": "Smoke revision"},
            )
            await request(
                client,
                "POST",
                f"/v1/portal/documents/{document_id}/uploaded",
                student_token,
                json=upload_body,
            )
            await request(client, "POST", f"/v1/documents/{document_id}/approve", curator_token)

            application = await request(
                client,
                "POST",
                "/v1/applications",
                curator_token,
                json={
                    "student_id": student_id,
                    "program_id": program_id,
                    "intake": "2027/28",
                    "hard_deadline": (datetime.now(UTC) + timedelta(days=30)).isoformat(),
                },
            )
            application_id = application.json()["id"]
            await request(
                client,
                "PATCH",
                f"/v1/applications/{application_id}/status",
                curator_token,
                json={"status": "READY_TO_SUBMIT"},
            )
            submitted = await request(
                client,
                "POST",
                f"/v1/applications/{application_id}/submit",
                curator_token,
                json={"application_fee_paid": True},
            )
            if not submitted.json().get("ok"):
                raise RuntimeError("Application submission was blocked unexpectedly")
            await request(
                client,
                "POST",
                "/v1/deadlines",
                curator_token,
                json={
                    "student_id": student_id,
                    "application_id": application_id,
                    "title": "Smoke follow-up",
                    "date": (datetime.now(UTC) + timedelta(days=10)).isoformat(),
                    "type": "OTHER",
                },
            )
            await request(
                client,
                "POST",
                "/v1/portal/messages",
                student_token,
                json={"text": "Smoke student message"},
            )
            await request(
                client,
                "POST",
                f"/v1/students/{student_id}/messages",
                curator_token,
                json={"text": "Smoke curator reply"},
            )
            await request(
                client,
                "POST",
                f"/v1/notifications/{notification_id}/read",
                student_token,
            )
            for path, token in (
                ("/v1/dashboard/overview", curator_token),
                ("/v1/portal/overview", student_token),
                ("/v1/deadlines", student_token),
                (f"/v1/students/{student_id}/messages", student_token),
            ):
                await request(client, "GET", path, token)
        print("SMOKE_RESULT=passed")
    finally:
        async with engine.begin() as db:
            await db.execute(
                text('DELETE FROM "InAppNotification" WHERE "studentId" = :student_id'),
                {"student_id": student_id},
            )
            await db.execute(
                text('DELETE FROM "Activity" WHERE "studentId" = :student_id'),
                {"student_id": student_id},
            )
            await db.execute(
                text('DELETE FROM "Deadline" WHERE "studentId" = :student_id'),
                {"student_id": student_id},
            )
            await db.execute(
                text('DELETE FROM "Task" WHERE "studentId" = :student_id'),
                {"student_id": student_id},
            )
            await db.execute(
                text(
                    'DELETE FROM "Requirement" WHERE "applicationId" IN '
                    '(SELECT "id" FROM "Application" WHERE "studentId" = :student_id)'
                ),
                {"student_id": student_id},
            )
            await db.execute(
                text('DELETE FROM "Application" WHERE "studentId" = :student_id'),
                {"student_id": student_id},
            )
            await db.execute(
                text('DELETE FROM "Document" WHERE "studentId" = :student_id'),
                {"student_id": student_id},
            )
            await db.execute(
                text('DELETE FROM "Student" WHERE "id" = :student_id'), {"student_id": student_id}
            )
            await db.execute(
                text('DELETE FROM "User" WHERE "id" IN (:curator_id, :student_user_id)'),
                {"curator_id": curator_id, "student_user_id": student_user_id},
            )
        await engine.dispose()
        print("SMOKE_FIXTURE=removed")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--confirm", action="store_true")
    parser.add_argument("--base-url", default="http://127.0.0.1:8000")
    args = parser.parse_args()
    if not args.confirm:
        raise SystemExit("Pass --confirm to create and remove the disposable smoke fixture")
    asyncio.run(run(args.base_url))
