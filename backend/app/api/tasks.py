from datetime import UTC, datetime, timedelta
from typing import Annotated, Literal
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from sqlalchemy import insert, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import CurrentActor, StaffActor
from app.db.session import get_db_session
from app.db.tables import activity_table, student_table, task_table
from app.schemas.tasks import CreateTaskRequest, TaskStudent, TaskSummary

router = APIRouter(tags=["tasks"])
DbSession = Annotated[AsyncSession, Depends(get_db_session)]
TaskView = Literal["my", "today", "overdue", "upcoming", "waiting", "completed"]


async def assert_task_access(
    actor: StaffActor, db: AsyncSession, task_id: str
) -> dict[str, str | None]:
    row = (
        (
            await db.execute(
                select(
                    task_table.c.id,
                    task_table.c.title,
                    task_table.c.studentId,
                    task_table.c.applicationId,
                    student_table.c.curatorId,
                )
                .join(student_table, student_table.c.id == task_table.c.studentId)
                .where(task_table.c.id == task_id)
            )
        )
        .mappings()
        .first()
    )
    if row is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Task not found")
    if actor.role == "CURATOR" and row.curatorId not in {actor.id, None}:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Student access denied")
    return dict(row)


async def assert_student_access(actor: StaffActor, db: AsyncSession, student_id: str) -> None:
    statement = select(student_table.c.curatorId).where(student_table.c.id == student_id)
    row = (await db.execute(statement)).mappings().first()
    if row is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Student not found")
    if actor.role == "CURATOR" and row.curatorId not in {actor.id, None}:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Student access denied")


@router.get("/tasks", response_model=list[TaskSummary])
async def list_tasks(
    actor: StaffActor,
    db: DbSession,
    view: Annotated[TaskView, Query()] = "my",
) -> list[TaskSummary]:
    statement = (
        select(
            task_table.c.id,
            task_table.c.title,
            task_table.c.description,
            task_table.c.status,
            task_table.c.priority,
            task_table.c.studentId,
            task_table.c.applicationId,
            task_table.c.dueDate,
            student_table.c.id.label("student_id"),
            student_table.c.firstName.label("student_first_name"),
            student_table.c.lastName.label("student_last_name"),
        )
        .join(student_table, student_table.c.id == task_table.c.studentId)
        .order_by(task_table.c.dueDate.asc().nulls_last(), task_table.c.createdAt.desc())
    )
    if actor.role == "CURATOR":
        statement = statement.where(student_table.c.curatorId == actor.id)

    now = datetime.now(UTC)
    today_start = now.replace(hour=0, minute=0, second=0, microsecond=0)
    tomorrow_start = today_start + timedelta(days=1)
    if view == "my":
        statement = statement.where(
            task_table.c.assigneeId == actor.id, task_table.c.status != "DONE"
        )
    elif view == "today":
        statement = statement.where(
            task_table.c.status != "DONE",
            task_table.c.dueDate >= today_start,
            task_table.c.dueDate < tomorrow_start,
        )
    elif view == "overdue":
        statement = statement.where(
            task_table.c.status != "DONE", task_table.c.dueDate < today_start
        )
    elif view == "upcoming":
        statement = statement.where(
            task_table.c.status != "DONE", task_table.c.dueDate >= tomorrow_start
        )
    elif view == "waiting":
        statement = statement.where(task_table.c.status == "WAITING")
    elif view == "completed":
        statement = statement.where(task_table.c.status == "DONE")

    rows = (await db.execute(statement)).mappings()
    return [
        TaskSummary(
            id=row.id,
            title=row.title,
            description=row.description,
            status=row.status,
            priority=row.priority,
            student_id=row.studentId,
            application_id=row.applicationId,
            due_date=row.dueDate,
            student=TaskStudent(
                id=row.student_id,
                first_name=row.student_first_name,
                last_name=row.student_last_name,
            ),
        )
        for row in rows
    ]


@router.post("/tasks", response_model=TaskSummary, status_code=status.HTTP_201_CREATED)
async def create_task(actor: StaffActor, db: DbSession, request: CreateTaskRequest) -> TaskSummary:
    await assert_student_access(actor, db, request.student_id)
    now = datetime.now(UTC)
    task_id = uuid4().hex
    await db.rollback()
    async with db.begin():
        await db.execute(
            insert(task_table).values(
                id=task_id,
                title=request.title.strip(),
                description=request.description,
                status="TODO",
                priority=request.priority,
                assigneeId=actor.id,
                studentId=request.student_id,
                applicationId=request.application_id,
                dueDate=request.due_date,
                isStudentFacing=request.is_student_facing,
                createdAt=now,
                updatedAt=now,
            )
        )
        await db.execute(
            insert(activity_table).values(
                id=uuid4().hex,
                type="TASK_CREATED",
                studentId=request.student_id,
                applicationId=request.application_id,
                userId=actor.id,
                metadata='{"source":"python-api"}',
                createdAt=now,
            )
        )
    return TaskSummary(
        id=task_id,
        title=request.title.strip(),
        description=request.description,
        status="TODO",
        priority=request.priority,
        student_id=request.student_id,
        application_id=request.application_id,
        due_date=request.due_date,
        student=TaskStudent(id=request.student_id, first_name="", last_name=""),
    )


@router.post("/tasks/{task_id}/complete", status_code=status.HTTP_204_NO_CONTENT)
async def complete_task(actor: StaffActor, db: DbSession, task_id: str) -> Response:
    task = await assert_task_access(actor, db, task_id)
    now = datetime.now(UTC)
    await db.rollback()
    async with db.begin():
        await db.execute(
            update(task_table)
            .where(task_table.c.id == task_id)
            .values(status="DONE", completedAt=now, updatedAt=now)
        )
        await db.execute(
            insert(activity_table).values(
                id=uuid4().hex,
                type="TASK_COMPLETED",
                studentId=task["studentId"],
                applicationId=task["applicationId"],
                userId=actor.id,
                metadata='{"source":"python-api"}',
                createdAt=now,
            )
        )
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/portal/tasks/{task_id}/complete", status_code=status.HTTP_204_NO_CONTENT)
async def complete_student_task(actor: CurrentActor, db: DbSession, task_id: str) -> Response:
    if actor.role != "STUDENT":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Student access required")
    task = (
        (
            await db.execute(
                select(task_table.c.id, task_table.c.studentId)
                .join(student_table, student_table.c.id == task_table.c.studentId)
                .where(
                    task_table.c.id == task_id,
                    task_table.c.isStudentFacing.is_(True),
                    student_table.c.userId == actor.id,
                )
            )
        )
        .mappings()
        .first()
    )
    if task is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Task not found")
    await db.execute(
        update(task_table)
        .where(task_table.c.id == task_id)
        .values(status="DONE", completedAt=datetime.now(UTC), updatedAt=datetime.now(UTC))
    )
    await db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)
