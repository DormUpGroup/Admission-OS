import json
from datetime import UTC, datetime
from typing import Annotated
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import insert, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import CurrentActor, StaffActor
from app.db.session import get_db_session
from app.db.tables import activity_table, student_table, user_table
from app.schemas.messages import MessageSummary, SendMessageRequest

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


def _message(row) -> MessageSummary | None:
    try:
        meta = json.loads(row.metadata or "{}")
    except json.JSONDecodeError:
        return None
    if meta.get("channel") != "student-curator":
        return None
    text = str(meta.get("note") or "").strip()
    attachments = meta.get("attachments") if isinstance(meta.get("attachments"), list) else []
    if not text and not attachments:
        return None
    from_student = meta.get("from") == "student"
    return MessageSummary(
        id=row.id,
        student_id=row.studentId,
        text=text,
        from_student=from_student,
        author=(f"{row.firstName} {row.lastName}" if from_student else (row.userName or "Куратор")),
        attachments=attachments,
        created_at=row.createdAt,
    )


@router.get("/students/{student_id}/messages", response_model=list[MessageSummary])
async def list_messages(
    actor: CurrentActor, db: DbSession, student_id: str
) -> list[MessageSummary]:
    await _student_for_actor(actor, db, student_id)
    rows = (
        await db.execute(
            select(
                activity_table,
                student_table.c.firstName,
                student_table.c.lastName,
                user_table.c.name.label("userName"),
            )
            .join(student_table, student_table.c.id == activity_table.c.studentId)
            .outerjoin(user_table, user_table.c.id == activity_table.c.userId)
            .where(activity_table.c.studentId == student_id, activity_table.c.type == "NOTE")
            .order_by(activity_table.c.createdAt)
        )
    ).mappings()
    return [message for row in rows if (message := _message(row)) is not None]


@router.post(
    "/students/{student_id}/messages",
    response_model=MessageSummary,
    status_code=status.HTTP_201_CREATED,
)
async def send_staff_message(
    actor: StaffActor, db: DbSession, student_id: str, request: SendMessageRequest
) -> MessageSummary:
    await _student_for_actor(actor, db, student_id)
    text = request.text.strip()
    if not text and not request.attachments:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail="Message is empty"
        )
    now = datetime.now(UTC)
    message_id = uuid4().hex
    meta = {
        "note": text,
        "channel": "student-curator",
        "from": "curator",
        "attachments": [x.model_dump(by_alias=False) for x in request.attachments],
    }
    await db.execute(
        insert(activity_table).values(
            id=message_id,
            type="NOTE",
            studentId=student_id,
            userId=actor.id,
            metadata=json.dumps(meta),
            createdAt=now,
        )
    )
    await db.commit()
    return MessageSummary(
        id=message_id,
        student_id=student_id,
        text=text,
        from_student=False,
        author="Куратор",
        attachments=request.attachments,
        created_at=now,
    )


@router.post("/portal/messages", response_model=MessageSummary, status_code=status.HTTP_201_CREATED)
async def send_student_message(
    actor: CurrentActor, db: DbSession, request: SendMessageRequest
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
    now = datetime.now(UTC)
    message_id = uuid4().hex
    meta = {
        "note": text,
        "channel": "student-curator",
        "from": "student",
        "attachments": [x.model_dump() for x in request.attachments],
    }
    await db.execute(
        insert(activity_table).values(
            id=message_id,
            type="NOTE",
            studentId=student.id,
            userId=actor.id,
            metadata=json.dumps(meta),
            createdAt=now,
        )
    )
    await db.commit()
    return MessageSummary(
        id=message_id,
        student_id=student.id,
        text=text,
        from_student=True,
        author=f"{student.firstName} {student.lastName}",
        attachments=request.attachments,
        created_at=now,
    )
