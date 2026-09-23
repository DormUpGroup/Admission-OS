from datetime import UTC, datetime, timedelta

from sqlalchemy import insert, select, update
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.db.tables import (
    application_table,
    metadata,
    program_table,
    requirement_table,
    student_table,
    university_table,
)
from app.schemas.applications import AddRequirementRequest, CreateApplicationRequest
from app.schemas.documents import CreateDocumentRequest, DocumentUploadRequest
from app.schemas.students import CreateStudentRequest
from app.services.commands.applications import (
    add_requirement_command,
    create_application_command,
)
from app.services.commands.base import CommandContext, execute_command
from app.services.commands.documents import (
    approve_document_command,
    create_document_command,
    request_document_command,
    upload_document_command,
)
from app.services.commands.students import create_student_command


async def _database():
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    async with engine.begin() as connection:
        await connection.run_sync(metadata.create_all)
    factory = async_sessionmaker(engine, expire_on_commit=False)
    async with factory() as db:
        await db.execute(
            insert(university_table).values(
                id="uni_1",
                name="Sapienza",
                slug="sapienza",
                city="Rome",
                region="Lazio",
                country="IT",
                publicPrivate="PUBLIC",
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
        await db.commit()
    return engine, factory


def _context(operation: str, key: str) -> CommandContext:
    return CommandContext(
        principal_id="curator_1",
        operation=operation,
        idempotency_key=key,
        correlation_id=key,
        actor_type="USER",
        actor_id="curator_1",
    )


async def test_golden_admissions_flow_persists_derived_state_once() -> None:
    engine, factory = await _database()
    hard_deadline = datetime.now(UTC) + timedelta(days=7)
    async with factory() as db:
        async with db.begin():
            student = await execute_command(
                db,
                context=_context("student.create", "golden-student"),
                payload={"email": "ada@example.test"},
                handler=lambda command: create_student_command(
                    db,
                    context=command,
                    request=CreateStudentRequest(
                        first_name="Ada",
                        last_name="Lovelace",
                        email="ada@example.test",
                        intake="2027/28",
                        curator_id="curator_1",
                    ),
                ),
            )
            student_id = student.result.entity_id
            assert student_id
            application = await execute_command(
                db,
                context=_context("application.create", "golden-application"),
                payload={"student_id": student_id, "program_id": "prog_1"},
                handler=lambda command: create_application_command(
                    db,
                    context=command,
                    request=CreateApplicationRequest(
                        student_id=student_id,
                        program_id="prog_1",
                        intake="2027/28",
                        hard_deadline=hard_deadline,
                    ),
                    program={
                        "id": "prog_1",
                        "name": "Computer Science",
                        "university_name": "Sapienza",
                    },
                    student_initiated=False,
                ),
            )
            application_id = application.result.entity_id
            assert application_id
            requirement = await execute_command(
                db,
                context=_context("requirement.create", "golden-requirement"),
                payload={"name": "Transcript"},
                handler=lambda command: add_requirement_command(
                    db,
                    context=command,
                    application_id=application_id,
                    request=AddRequirementRequest(
                        name="Transcript", type="DOCUMENT", is_critical=True
                    ),
                ),
            )
            document = await execute_command(
                db,
                context=_context("document.create", "golden-document"),
                payload={"name": "Transcript"},
                handler=lambda command: create_document_command(
                    db,
                    context=command,
                    student_id=student_id,
                    request=CreateDocumentRequest(
                        student_id=student_id,
                        name="Transcript",
                        category="EDUCATION",
                    ),
                ),
            )
            document_id = document.result.entity_id
            assert document_id
            await db.execute(
                update(requirement_table)
                .where(requirement_table.c.id == requirement.result.entity_id)
                .values(relatedDocumentId=document_id)
            )
            await execute_command(
                db,
                context=_context("document.request", "golden-request"),
                payload={"document_id": document_id},
                handler=lambda command: request_document_command(
                    db, context=command, document_id=document_id
                ),
            )
            await execute_command(
                db,
                context=_context("document.upload", "golden-upload"),
                payload={"document_id": document_id},
                handler=lambda command: upload_document_command(
                    db,
                    context=command,
                    document_id=document_id,
                    request=DocumentUploadRequest(
                        storage_path="students/ada/transcript.pdf",
                        file_url="/files/transcript.pdf",
                    ),
                    curator_id="curator_1",
                ),
            )
            await execute_command(
                db,
                context=_context("document.approve", "golden-approve"),
                payload={"document_id": document_id},
                handler=lambda command: approve_document_command(
                    db, context=command, document_id=document_id
                ),
            )

        student_row = (
            await db.execute(select(student_table).where(student_table.c.id == student_id))
        ).mappings().one()
        application_row = (
            await db.execute(
                select(application_table).where(application_table.c.id == application_id)
            )
        ).mappings().one()
        requirement_row = (
            await db.execute(
                select(requirement_table).where(
                    requirement_table.c.id == requirement.result.entity_id
                )
            )
        ).mappings().one()

    assert requirement_row.status == "COMPLETED"
    assert application_row.readinessPercent == 100
    assert application_row.riskLevel == "NONE"
    assert application_row.status == "READY_FOR_REVIEW"
    assert student_row.riskLevel == "NONE"
    assert student_row.nextActionJson is not None
    assert "UPCOMING_DEADLINE" in student_row.nextActionJson
    assert "Sapienza hard deadline" in student_row.nextActionJson
    await engine.dispose()
