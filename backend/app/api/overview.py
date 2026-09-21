from datetime import UTC, datetime, timedelta
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import CurrentActor, StaffActor
from app.db.session import get_db_session
from app.db.tables import (
    application_table,
    deadline_table,
    document_table,
    notification_table,
    student_table,
    task_table,
)
from app.schemas.overview import DashboardOverview, PortalOverview

router = APIRouter(tags=["overview"])
DbSession = Annotated[AsyncSession, Depends(get_db_session)]


def _staff_scope(actor: StaffActor):
    return None if actor.role == "ADMIN" else student_table.c.curatorId == actor.id


@router.get("/dashboard/overview", response_model=DashboardOverview)
async def dashboard_overview(actor: StaffActor, db: DbSession) -> DashboardOverview:
    scope = _staff_scope(actor)
    today = datetime.now(UTC).replace(hour=0, minute=0, second=0, microsecond=0)
    week = today + timedelta(days=8)

    async def count(statement):
        return int((await db.execute(statement)).scalar_one())

    student_filter = [student_table.c.status.not_in(["ARCHIVED", "COMPLETED"])]
    if scope is not None:
        student_filter.append(scope)
    active_students = await count(select(func.count(student_table.c.id)).where(*student_filter))
    high_risk_applications = await count(
        select(func.count(application_table.c.id))
        .join(student_table, student_table.c.id == application_table.c.studentId)
        .where(application_table.c.riskLevel.in_(["HIGH", "CRITICAL"]), *student_filter)
    )
    documents_to_review = await count(
        select(func.count(document_table.c.id))
        .join(student_table, student_table.c.id == document_table.c.studentId)
        .where(document_table.c.status.in_(["UPLOADED", "UNDER_REVIEW"]), *student_filter)
    )
    open_tasks = await count(
        select(func.count(task_table.c.id))
        .join(student_table, student_table.c.id == task_table.c.studentId)
        .where(task_table.c.status != "DONE", *student_filter)
    )
    upcoming_deadlines = await count(
        select(func.count(deadline_table.c.id))
        .join(student_table, student_table.c.id == deadline_table.c.studentId)
        .where(deadline_table.c.date >= today, deadline_table.c.date < week, *student_filter)
    )
    unread = await count(
        select(func.count(notification_table.c.id)).where(
            notification_table.c.userId == actor.id, notification_table.c.readAt.is_(None)
        )
    )
    return DashboardOverview(
        active_students=active_students,
        high_risk_applications=high_risk_applications,
        documents_to_review=documents_to_review,
        open_tasks=open_tasks,
        upcoming_deadlines=upcoming_deadlines,
        unread_notifications=unread,
    )


@router.get("/portal/overview", response_model=PortalOverview)
async def portal_overview(actor: CurrentActor, db: DbSession) -> PortalOverview:
    if actor.role != "STUDENT":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Student access required")
    student = (
        (await db.execute(select(student_table.c.id).where(student_table.c.userId == actor.id)))
        .mappings()
        .first()
    )
    if student is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Student not found")

    async def count(table, *where):
        return int((await db.execute(select(func.count(table.c.id)).where(*where))).scalar_one())

    today = datetime.now(UTC).replace(hour=0, minute=0, second=0, microsecond=0)
    applications = await count(application_table, application_table.c.studentId == student.id)
    documents_total = await count(document_table, document_table.c.studentId == student.id)
    documents_needing_upload = await count(
        document_table,
        document_table.c.studentId == student.id,
        document_table.c.status.in_(["MISSING", "REQUESTED", "NEEDS_CHANGES"]),
    )
    documents_awaiting_review = await count(
        document_table,
        document_table.c.studentId == student.id,
        document_table.c.status.in_(["UPLOADED", "UNDER_REVIEW"]),
    )
    open_tasks = await count(
        task_table,
        task_table.c.studentId == student.id,
        task_table.c.isStudentFacing.is_(True),
        task_table.c.status != "DONE",
    )
    upcoming_deadlines = await count(
        deadline_table,
        deadline_table.c.studentId == student.id,
        deadline_table.c.isInternal.is_(False),
        deadline_table.c.date >= today,
    )
    unread = await count(
        notification_table,
        notification_table.c.userId == actor.id,
        notification_table.c.readAt.is_(None),
    )
    next_deadline = (
        await db.execute(
            select(deadline_table.c.date)
            .where(
                deadline_table.c.studentId == student.id,
                deadline_table.c.isInternal.is_(False),
                deadline_table.c.date >= today,
            )
            .order_by(deadline_table.c.date)
            .limit(1)
        )
    ).scalar_one_or_none()
    return PortalOverview(
        student_id=student.id,
        applications=applications,
        documents_total=documents_total,
        documents_needing_upload=documents_needing_upload,
        documents_awaiting_review=documents_awaiting_review,
        open_tasks=open_tasks,
        upcoming_deadlines=upcoming_deadlines,
        unread_notifications=unread,
        next_deadline_at=next_deadline,
    )
