from datetime import UTC, datetime, timedelta
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import CurrentActor, StaffActor
from app.db.session import get_db_session
from app.db.tables import student_table, task_table
from app.schemas.tasks import CreateTaskRequest, TaskStudent, TaskSummary
from app.services.commands.base import (
    CommandContext,
    CommandResult,
    execute_command,
    require_idempotency_key,
)
from app.services.commands.tasks import complete_task_command, create_task_command

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
                    task_table.c.status,
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


async def _create_task_result(
    db: AsyncSession,
    context: CommandContext,
    assignee_id: str,
    request: CreateTaskRequest,
) -> CommandResult:
    result = await create_task_command(
        db,
        student_id=request.student_id,
        title=request.title,
        description=request.description,
        priority=request.priority,
        assignee_id=assignee_id,
        application_id=request.application_id,
        due_date=request.due_date,
        is_student_facing=request.is_student_facing,
        actor_type=context.actor_type,
        actor_id=context.actor_id,
        correlation_id=context.correlation_id,
        idempotency_key=f"task:create:{context.idempotency_key}",
    )
    return CommandResult(
        response=result,
        http_status=status.HTTP_201_CREATED,
        entity_type="Task",
        entity_id=result["id"],
    )


async def _complete_task_result(
    db: AsyncSession,
    context: CommandContext,
    task_id: str,
    task: dict,
) -> CommandResult:
    await complete_task_command(
        db,
        task_id=task_id,
        task=task,
        actor_type=context.actor_type,
        actor_id=context.actor_id,
        correlation_id=context.correlation_id,
        idempotency_key=f"{context.operation}:{context.idempotency_key}",
    )
    return CommandResult(
        response={"task_id": task_id, "status": "DONE"},
        http_status=status.HTTP_204_NO_CONTENT,
        entity_type="Task",
        entity_id=task_id,
    )


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
async def create_task(
    actor: StaffActor,
    db: DbSession,
    request: CreateTaskRequest,
    idempotency_key: Annotated[str, Depends(require_idempotency_key)],
) -> TaskSummary:
    await assert_student_access(actor, db, request.student_id)
    await db.rollback()
    async with db.begin():
        context = CommandContext(
            principal_id=actor.id,
            operation="task.create",
            idempotency_key=idempotency_key,
            correlation_id=idempotency_key,
            actor_type="USER",
            actor_id=actor.id,
        )
        executed = await execute_command(
            db,
            context=context,
            payload=request.model_dump(mode="json"),
            handler=lambda command: _create_task_result(
                db, command, actor.id, request
            ),
        )
    return TaskSummary(
        **executed.result.response,
        student=TaskStudent(id=request.student_id, first_name="", last_name=""),
    )


@router.post("/tasks/{task_id}/complete", status_code=status.HTTP_204_NO_CONTENT)
async def complete_task(
    actor: StaffActor,
    db: DbSession,
    task_id: str,
    idempotency_key: Annotated[str, Depends(require_idempotency_key)],
) -> Response:
    task = await assert_task_access(actor, db, task_id)
    await db.rollback()
    async with db.begin():
        context = CommandContext(
            principal_id=actor.id,
            operation="task.complete",
            idempotency_key=idempotency_key,
            actor_type="USER",
            actor_id=actor.id,
            correlation_id=idempotency_key,
        )
        await execute_command(
            db,
            context=context,
            payload={"task_id": task_id},
            handler=lambda command: _complete_task_result(
                db, command, task_id, task
            ),
        )
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/portal/tasks/{task_id}/complete", status_code=status.HTTP_204_NO_CONTENT)
async def complete_student_task(
    actor: CurrentActor,
    db: DbSession,
    task_id: str,
    idempotency_key: Annotated[str, Depends(require_idempotency_key)],
) -> Response:
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
    task_data = dict(task)
    task_data["applicationId"] = None
    task_data["status"] = "TODO"
    await db.rollback()
    async with db.begin():
        context = CommandContext(
            principal_id=actor.id,
            operation="portal.task.complete",
            idempotency_key=idempotency_key,
            actor_type="USER",
            actor_id=actor.id,
            correlation_id=idempotency_key,
        )
        await execute_command(
            db,
            context=context,
            payload={"task_id": task_id},
            handler=lambda command: _complete_task_result(
                db, command, task_id, task_data
            ),
        )
    return Response(status_code=status.HTTP_204_NO_CONTENT)
