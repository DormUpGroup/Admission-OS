from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import exists, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import StaffActor
from app.db.session import get_db_session
from app.db.tables import application_table, document_table, student_table, user_table
from app.schemas.students import StudentSummary

router = APIRouter(tags=["students"])
DbSession = Annotated[AsyncSession, Depends(get_db_session)]


def to_student_summary(row: object) -> StudentSummary:
    data = row  # SQLAlchemy RowMapping has typed attribute access at runtime.
    return StudentSummary(
        id=data.id,
        first_name=data.firstName,
        last_name=data.lastName,
        email=data.email,
        status=data.status,
        journey_stage=data.journeyStage,
        risk_level=data.riskLevel,
        intake=data.intake,
        target_field=data.targetField,
        preferred_language=data.preferredLanguage,
        curator_id=data.curatorId,
        curator_name=data.curator_name,
        study_level=data.studyLevel,
        country=data.country,
        next_action_json=data.nextActionJson,
        application_count=data.application_count,
        document_count=data.document_count,
        approved_document_count=data.approved_document_count,
    )


def student_scope(actor: StaffActor):
    if actor.role == "ADMIN":
        return None
    return or_(student_table.c.curatorId == actor.id, student_table.c.curatorId.is_(None))


def student_summary_statement():
    applications_count = (
        select(func.count(application_table.c.id))
        .where(application_table.c.studentId == student_table.c.id)
        .scalar_subquery()
    )
    documents_count = (
        select(func.count(document_table.c.id))
        .where(document_table.c.studentId == student_table.c.id)
        .scalar_subquery()
    )
    approved_documents_count = (
        select(func.count(document_table.c.id))
        .where(
            document_table.c.studentId == student_table.c.id,
            document_table.c.status == "APPROVED",
        )
        .scalar_subquery()
    )
    return select(
        student_table,
        user_table.c.name.label("curator_name"),
        applications_count.label("application_count"),
        documents_count.label("document_count"),
        approved_documents_count.label("approved_document_count"),
    ).outerjoin(user_table, user_table.c.id == student_table.c.curatorId)


@router.get("/students", response_model=list[StudentSummary])
async def list_students(
    actor: StaffActor,
    db: DbSession,
    query: Annotated[str | None, Query(min_length=1, max_length=120)] = None,
    view: Annotated[str, Query(pattern="^(my|all|risk|waiting|completed)$")] = "all",
    intake: str | None = None,
    curator_id: str | None = None,
    study_level: str | None = None,
    country: str | None = None,
) -> list[StudentSummary]:
    statement = student_summary_statement().order_by(
        student_table.c.lastName, student_table.c.firstName
    )
    scope = student_scope(actor)
    if scope is not None:
        statement = statement.where(scope)
    if view == "my":
        statement = statement.where(student_table.c.curatorId == actor.id)
    elif view == "risk":
        statement = statement.where(student_table.c.riskLevel.in_(["HIGH", "CRITICAL"]))
    elif view == "waiting":
        statement = statement.where(
            exists(
                select(document_table.c.id).where(
                    document_table.c.studentId == student_table.c.id,
                    document_table.c.status.in_(["REQUESTED", "NEEDS_CHANGES"]),
                )
            )
        )
    elif view == "completed":
        statement = statement.where(student_table.c.status == "COMPLETED")
    if query:
        phrase = f"%{query.strip()}%"
        statement = statement.where(
            or_(
                student_table.c.firstName.ilike(phrase),
                student_table.c.lastName.ilike(phrase),
                student_table.c.email.ilike(phrase),
            )
        )
    if intake:
        statement = statement.where(student_table.c.intake == intake)
    if curator_id and actor.role == "ADMIN":
        statement = statement.where(student_table.c.curatorId == curator_id)
    if study_level:
        statement = statement.where(student_table.c.studyLevel == study_level)
    if country:
        statement = statement.where(student_table.c.country.ilike(f"%{country.strip()}%"))
    rows = (await db.execute(statement)).mappings()
    return [to_student_summary(row) for row in rows]


@router.get("/students/{student_id}", response_model=StudentSummary)
async def get_student(actor: StaffActor, db: DbSession, student_id: str) -> StudentSummary:
    statement = student_summary_statement().where(student_table.c.id == student_id)
    scope = student_scope(actor)
    if scope is not None:
        statement = statement.where(scope)
    row = (await db.execute(statement)).mappings().first()
    if row is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Student not found")
    return to_student_summary(row)
