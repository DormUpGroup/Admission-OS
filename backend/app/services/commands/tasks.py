from datetime import UTC, datetime
from typing import Any
from uuid import uuid4

from fastapi import HTTPException, status
from sqlalchemy import insert, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.tables import activity_table, outbox_event_table, task_table
from app.events.records import append_audit, append_outbox
from app.services.commands.base import CommandContext, CommandResult
from app.services.operations.recalculate import recalculate_student


async def create_task_from_context(
    db: AsyncSession,
    *,
    context: CommandContext,
    student_id: str,
    title: str,
    description: str | None = None,
    priority: str = "MEDIUM",
    assignee_id: str | None = None,
    application_id: str | None = None,
    due_date: datetime | None = None,
    is_student_facing: bool = False,
) -> CommandResult:
    result = await create_task_command(
        db,
        student_id=student_id,
        title=title,
        description=description,
        priority=priority,
        assignee_id=assignee_id,
        application_id=application_id,
        due_date=due_date,
        is_student_facing=is_student_facing,
        actor_type=context.actor_type,
        actor_id=context.actor_id,
        correlation_id=context.correlation_id,
        idempotency_key=f"task:create:{context.idempotency_key}",
    )
    return CommandResult(
        response=result,
        http_status=201,
        entity_type="Task",
        entity_id=result["id"],
    )


async def create_task_command(
    db: AsyncSession,
    *,
    student_id: str,
    title: str,
    description: str | None,
    priority: str,
    assignee_id: str | None,
    application_id: str | None,
    due_date: datetime | None,
    is_student_facing: bool,
    actor_type: str,
    actor_id: str,
    correlation_id: str,
    idempotency_key: str,
    now: datetime | None = None,
) -> dict[str, Any]:
    now = now or datetime.now(UTC)
    existing_event = (
        await db.execute(
            select(outbox_event_table.c.payloadJson).where(
                outbox_event_table.c.idempotencyKey == idempotency_key
            )
        )
    ).scalar_one_or_none()
    if existing_event and existing_event.get("task_id"):
        existing_task = (
            await db.execute(
                select(task_table).where(task_table.c.id == existing_event["task_id"])
            )
        ).mappings().first()
        if existing_task:
            return {
                "id": existing_task.id,
                "title": existing_task.title,
                "description": existing_task.description,
                "status": existing_task.status,
                "priority": existing_task.priority,
                "student_id": existing_task.studentId,
                "application_id": existing_task.applicationId,
                "due_date": existing_task.dueDate,
            }
    task_id = uuid4().hex
    await db.execute(
        insert(task_table).values(
            id=task_id,
            title=title.strip(),
            description=description,
            status="TODO",
            priority=priority,
            assigneeId=assignee_id,
            studentId=student_id,
            applicationId=application_id,
            dueDate=due_date,
            isStudentFacing=is_student_facing,
            createdAt=now,
            updatedAt=now,
        )
    )
    await db.execute(
        insert(activity_table).values(
            id=uuid4().hex,
            type="TASK_CREATED",
            studentId=student_id,
            applicationId=application_id,
            userId=actor_id if actor_type == "USER" else None,
            metadata='{"source":"python-command"}',
            createdAt=now,
        )
    )
    await append_audit(
        db,
        actor_type=actor_type,
        actor_id=actor_id,
        user_id=actor_id if actor_type == "USER" else None,
        action="task.create",
        entity_type="Task",
        entity_id=task_id,
        correlation_id=correlation_id,
        after={"status": "TODO", "title": title.strip(), "studentId": student_id},
        now=now,
    )
    await append_outbox(
        db,
        aggregate_type="Task",
        aggregate_id=task_id,
        event_type="task.created.v1",
        payload={"task_id": task_id, "student_id": student_id},
        idempotency_key=idempotency_key,
        now=now,
    )
    await recalculate_student(db, student_id, now)
    return {
        "id": task_id,
        "title": title.strip(),
        "description": description,
        "status": "TODO",
        "priority": priority,
        "student_id": student_id,
        "application_id": application_id,
        "due_date": due_date,
    }


async def complete_task_command(
    db: AsyncSession,
    *,
    task_id: str,
    task: dict[str, Any] | None = None,
    actor_type: str,
    actor_id: str,
    correlation_id: str,
    idempotency_key: str,
    now: datetime | None = None,
) -> None:
    del task  # Always reload under row lock; ignore caller snapshot.
    now = now or datetime.now(UTC)
    locked = (
        await db.execute(
            select(task_table)
            .where(task_table.c.id == task_id)
            .with_for_update()
        )
    ).mappings().first()
    if locked is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Task not found"
        )
    if locked.status == "DONE":
        return
    domain_outbox_key = f"task:complete:{task_id}"
    existing_event = (
        await db.execute(
            select(outbox_event_table.c.id).where(
                outbox_event_table.c.idempotencyKey == domain_outbox_key
            )
        )
    ).scalar_one_or_none()
    if existing_event:
        return
    await db.execute(
        update(task_table)
        .where(task_table.c.id == task_id)
        .values(status="DONE", completedAt=now, updatedAt=now)
    )
    await db.execute(
        insert(activity_table).values(
            id=uuid4().hex,
            type="TASK_COMPLETED",
            studentId=locked.studentId,
            applicationId=locked.applicationId,
            userId=actor_id if actor_type == "USER" else None,
            metadata='{"source":"python-command"}',
            createdAt=now,
        )
    )
    await append_audit(
        db,
        actor_type=actor_type,
        actor_id=actor_id,
        user_id=actor_id if actor_type == "USER" else None,
        action="task.complete",
        entity_type="Task",
        entity_id=task_id,
        correlation_id=correlation_id,
        before={"status": locked.status},
        after={"status": "DONE"},
        now=now,
    )
    await append_outbox(
        db,
        aggregate_type="Task",
        aggregate_id=task_id,
        event_type="task.completed.v1",
        payload={"task_id": task_id, "student_id": locked.studentId},
        idempotency_key=domain_outbox_key,
        now=now,
    )
    await recalculate_student(db, locked.studentId, now)
