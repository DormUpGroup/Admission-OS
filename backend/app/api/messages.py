from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import CurrentActor, StaffActor
from app.db.session import get_db_session
from app.db.tables import (
    conversation_message_table,
    conversation_table,
    student_table,
    user_table,
)
from app.schemas.messages import MessageSummary, SendMessageRequest
from app.services.commands.base import (
    CommandContext,
    execute_command,
    require_idempotency_key,
)
from app.services.commands.messages import send_portal_message_command

router = APIRouter(tags=["messages"])
DbSession = Annotated[AsyncSession, Depends(get_db_session)]


async def _student_for_actor(actor: CurrentActor, db: AsyncSession, student_id: str):
    row = (
        (await db.execute(select(student_table).where(student_table.c.id == student_id)))
        .mappings()
        .first()
    )
    if row is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Student not found")
    if actor.role == "STUDENT" and row.userId != actor.id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Student access denied")
    if actor.role == "CURATOR" and row.curatorId not in {actor.id, None}:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Student access denied")
    return row


@router.get("/students/{student_id}/messages", response_model=list[MessageSummary])
async def list_messages(
    actor: CurrentActor, db: DbSession, student_id: str
) -> list[MessageSummary]:
    await _student_for_actor(actor, db, student_id)
    current_rows = (
        await db.execute(
            select(
                conversation_message_table,
                student_table.c.firstName,
                student_table.c.lastName,
                user_table.c.name.label("userName"),
            )
            .join(
                conversation_table,
                conversation_table.c.id
                == conversation_message_table.c.conversationId,
            )
            .join(student_table, student_table.c.id == conversation_table.c.studentId)
            .outerjoin(
                user_table,
                user_table.c.id == conversation_message_table.c.senderUserId,
            )
            .where(
                conversation_table.c.studentId == student_id,
                conversation_table.c.channel == "PORTAL",
            )
            .order_by(conversation_message_table.c.createdAt)
        )
    ).mappings().all()
    return [
        MessageSummary(
            id=row.id,
            student_id=student_id,
            text=row.body or "",
            from_student=row.senderType == "STUDENT",
            author=(
                f"{row.firstName} {row.lastName}"
                if row.senderType == "STUDENT"
                else (row.userName or "Куратор")
            ),
            attachments=row.attachmentsJson or [],
            created_at=row.createdAt,
        )
        for row in current_rows
    ]


@router.post(
    "/students/{student_id}/messages",
    response_model=MessageSummary,
    status_code=status.HTTP_201_CREATED,
)
async def send_staff_message(
    actor: StaffActor,
    db: DbSession,
    student_id: str,
    request: SendMessageRequest,
    idempotency_key: Annotated[str, Depends(require_idempotency_key)],
) -> MessageSummary:
    student = await _student_for_actor(actor, db, student_id)
    text = request.text.strip()
    if not text and not request.attachments:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail="Message is empty"
        )
    await db.rollback()
    async with db.begin():
        context = CommandContext(
            principal_id=actor.id,
            operation="message.staff.send",
            idempotency_key=idempotency_key,
            correlation_id=idempotency_key,
            actor_type="USER",
            actor_id=actor.id,
        )
        executed = await execute_command(
            db,
            context=context,
            payload={"student_id": student_id, **request.model_dump(mode="json")},
            handler=lambda command: send_portal_message_command(
                db,
                context=command,
                request=request,
                student_id=student_id,
                curator_id=student.curatorId or actor.id,
                from_student=False,
                author="Куратор",
            ),
        )
    return MessageSummary.model_validate(executed.result.response)


@router.post("/portal/messages", response_model=MessageSummary, status_code=status.HTTP_201_CREATED)
async def send_student_message(
    actor: CurrentActor,
    db: DbSession,
    request: SendMessageRequest,
    idempotency_key: Annotated[str, Depends(require_idempotency_key)],
) -> MessageSummary:
    if actor.role != "STUDENT":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Student access required")
    student = (
        (await db.execute(select(student_table).where(student_table.c.userId == actor.id)))
        .mappings()
        .first()
    )
    if student is None or not student.curatorId:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Curator is not assigned")
    text = request.text.strip()
    if not text and not request.attachments:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail="Message is empty"
        )
    await db.rollback()
    async with db.begin():
        context = CommandContext(
            principal_id=actor.id,
            operation="message.student.send",
            idempotency_key=idempotency_key,
            correlation_id=idempotency_key,
            actor_type="USER",
            actor_id=actor.id,
        )
        executed = await execute_command(
            db,
            context=context,
            payload=request.model_dump(mode="json"),
            handler=lambda command: send_portal_message_command(
                db,
                context=command,
                request=request,
                student_id=student.id,
                curator_id=student.curatorId,
                from_student=True,
                author=f"{student.firstName} {student.lastName}",
            ),
        )
    return MessageSummary.model_validate(executed.result.response)
