import json
from datetime import UTC, datetime, timedelta
from typing import Annotated
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import insert, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import CurrentActor, StaffActor
from app.db.session import get_db_session
from app.db.tables import (
    activity_table,
    document_table,
    requirement_table,
    student_table,
    task_table,
)
from app.schemas.documents import (
    CreateDocumentRequest,
    DocumentSummary,
    DocumentUploadRequest,
    NeedsChangesRequest,
)

router = APIRouter(tags=["documents"])
DbSession = Annotated[AsyncSession, Depends(get_db_session)]


async def get_document_for_staff(actor: StaffActor, db: AsyncSession, document_id: str):
    row = (
        (
            await db.execute(
                select(document_table, student_table.c.curatorId)
                .join(student_table, student_table.c.id == document_table.c.studentId)
                .where(document_table.c.id == document_id)
            )
        )
        .mappings()
        .first()
    )
    if row is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Document not found")
    if actor.role == "CURATOR" and row.curatorId not in {actor.id, None}:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Student access denied")
    return row


async def log_document_activity(
    db: AsyncSession, activity_type: str, document, user_id: str, metadata: str
) -> None:
    await db.execute(
        insert(activity_table).values(
            id=uuid4().hex,
            type=activity_type,
            studentId=document.studentId,
            userId=user_id,
            metadata=metadata,
            createdAt=datetime.now(UTC),
        )
    )


@router.get("/students/{student_id}/documents", response_model=list[DocumentSummary])
async def list_student_documents(
    actor: StaffActor, db: DbSession, student_id: str
) -> list[DocumentSummary]:
    student = (
        (
            await db.execute(
                select(student_table.c.curatorId).where(student_table.c.id == student_id)
            )
        )
        .mappings()
        .first()
    )
    if student is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Student not found")
    if actor.role == "CURATOR" and student.curatorId not in {actor.id, None}:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Student access denied")
    rows = (
        await db.execute(
            select(document_table)
            .where(document_table.c.studentId == student_id)
            .order_by(document_table.c.updatedAt.desc())
        )
    ).mappings()
    return [
        DocumentSummary(
            id=row.id,
            student_id=row.studentId,
            name=row.name,
            category=row.category,
            status=row.status,
            storage_path=row.storagePath,
            uploaded_at=row.uploadedAt,
            reviewed_at=row.reviewedAt,
            requested_at=row.requestedAt,
            student_feedback=row.studentFeedback,
            file_url=row.fileUrl,
        )
        for row in rows
    ]


@router.post("/documents/{document_id}/request", status_code=status.HTTP_204_NO_CONTENT)
async def request_document(actor: StaffActor, db: DbSession, document_id: str) -> None:
    document = await get_document_for_staff(actor, db, document_id)
    now = datetime.now(UTC)
    await db.rollback()
    async with db.begin():
        await db.execute(
            update(document_table)
            .where(document_table.c.id == document_id)
            .values(status="REQUESTED", requestedAt=now, studentFeedback=None, updatedAt=now)
        )
        await db.execute(
            insert(task_table).values(
                id=uuid4().hex,
                title=f"Upload {document.name}",
                status="WAITING",
                priority="HIGH",
                assigneeId=actor.id,
                studentId=document.studentId,
                documentId=document_id,
                isStudentFacing=True,
                dueDate=now + timedelta(days=7),
                createdAt=now,
                updatedAt=now,
            )
        )
        await log_document_activity(
            db,
            "DOCUMENT_REQUESTED",
            document,
            actor.id,
            json.dumps({"name": document.name, "source": "python-api"}),
        )


@router.post("/documents/{document_id}/approve", status_code=status.HTTP_204_NO_CONTENT)
async def approve_document(actor: StaffActor, db: DbSession, document_id: str) -> None:
    document = await get_document_for_staff(actor, db, document_id)
    now = datetime.now(UTC)
    await db.rollback()
    async with db.begin():
        await db.execute(
            update(document_table)
            .where(document_table.c.id == document_id)
            .values(
                status="APPROVED",
                reviewedAt=now,
                reviewedById=actor.id,
                studentFeedback=None,
                updatedAt=now,
            )
        )
        await db.execute(
            update(requirement_table)
            .where(requirement_table.c.relatedDocumentId == document_id)
            .values(status="COMPLETED")
        )
        await db.execute(
            update(task_table)
            .where(task_table.c.documentId == document_id, task_table.c.status != "DONE")
            .values(status="DONE", completedAt=now)
        )
        await log_document_activity(
            db,
            "DOCUMENT_APPROVED",
            document,
            actor.id,
            json.dumps({"name": document.name, "source": "python-api"}),
        )


@router.post(
    "/students/{student_id}/documents",
    response_model=DocumentSummary,
    status_code=status.HTTP_201_CREATED,
)
async def create_document(
    actor: StaffActor, db: DbSession, student_id: str, request: CreateDocumentRequest
) -> DocumentSummary:
    if request.student_id != student_id:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail="Student id mismatch"
        )
    student = (
        (
            await db.execute(
                select(student_table.c.curatorId).where(student_table.c.id == student_id)
            )
        )
        .mappings()
        .first()
    )
    if student is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Student not found")
    if actor.role == "CURATOR" and student.curatorId not in {actor.id, None}:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Student access denied")
    now = datetime.now(UTC)
    document_id = uuid4().hex
    await db.execute(
        insert(document_table).values(
            id=document_id,
            studentId=student_id,
            name=request.name.strip(),
            category=request.category,
            status="MISSING",
            createdAt=now,
            updatedAt=now,
        )
    )
    await db.commit()
    return DocumentSummary(
        id=document_id,
        student_id=student_id,
        name=request.name.strip(),
        category=request.category,
        status="MISSING",
        storage_path=None,
        uploaded_at=None,
        reviewed_at=None,
        requested_at=None,
        student_feedback=None,
        file_url=None,
    )


@router.post("/documents/{document_id}/needs-changes", status_code=status.HTTP_204_NO_CONTENT)
async def needs_changes_document(
    actor: StaffActor, db: DbSession, document_id: str, request: NeedsChangesRequest
) -> None:
    document = await get_document_for_staff(actor, db, document_id)
    reason = request.reason.strip()
    if not reason:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail="Reason is required"
        )
    now = datetime.now(UTC)
    await db.rollback()
    async with db.begin():
        await db.execute(
            update(document_table)
            .where(document_table.c.id == document_id)
            .values(
                status="NEEDS_CHANGES",
                reviewedAt=now,
                reviewedById=actor.id,
                studentFeedback=reason,
                requestedAt=now,
                updatedAt=now,
            )
        )
        await db.execute(
            update(requirement_table)
            .where(requirement_table.c.relatedDocumentId == document_id)
            .values(status="REQUESTED")
        )
        await db.execute(
            insert(task_table).values(
                id=uuid4().hex,
                title=f"Fix {document.name}",
                description=reason,
                status="TODO",
                priority="HIGH",
                assigneeId=actor.id,
                studentId=document.studentId,
                documentId=document_id,
                isStudentFacing=True,
                createdAt=now,
                updatedAt=now,
            )
        )
        await log_document_activity(
            db,
            "DOCUMENT_NEEDS_CHANGES",
            document,
            actor.id,
            json.dumps({"name": document.name, "reason": reason, "source": "python-api"}),
        )


@router.post("/portal/documents/{document_id}/uploaded", status_code=status.HTTP_204_NO_CONTENT)
async def mark_document_uploaded(
    actor: CurrentActor, db: DbSession, document_id: str, request: DocumentUploadRequest
) -> None:
    if actor.role != "STUDENT":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Student access required")
    document = (
        (
            await db.execute(
                select(document_table, student_table.c.userId, student_table.c.curatorId)
                .join(student_table, student_table.c.id == document_table.c.studentId)
                .where(document_table.c.id == document_id)
            )
        )
        .mappings()
        .first()
    )
    if document is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Document not found")
    if document.userId != actor.id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Document access denied")
    now = datetime.now(UTC)
    await db.rollback()
    async with db.begin():
        await db.execute(
            update(document_table)
            .where(document_table.c.id == document_id)
            .values(
                storagePath=request.storage_path,
                fileUrl=request.file_url,
                status="UPLOADED",
                uploadedAt=now,
                reviewedAt=None,
                reviewedById=None,
                studentFeedback=None,
                updatedAt=now,
            )
        )
        await db.execute(
            update(requirement_table)
            .where(
                requirement_table.c.relatedDocumentId == document_id,
                requirement_table.c.status.in_(["MISSING", "REQUESTED"]),
            )
            .values(status="UPLOADED")
        )
        await db.execute(
            insert(task_table).values(
                id=uuid4().hex,
                title=f"Review {document.name}",
                status="TODO",
                priority="HIGH",
                assigneeId=document.curatorId,
                studentId=document.studentId,
                documentId=document_id,
                isStudentFacing=False,
                createdAt=now,
                updatedAt=now,
            )
        )
        await log_document_activity(
            db,
            "DOCUMENT_UPLOADED",
            document,
            actor.id,
            json.dumps({"name": document.name, "source": "python-api"}),
        )
