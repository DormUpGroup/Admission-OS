from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import CurrentActor, StaffActor
from app.db.session import get_db_session
from app.db.tables import (
    document_table,
    student_table,
)
from app.schemas.documents import (
    CreateDocumentRequest,
    DocumentSummary,
    DocumentUploadRequest,
    NeedsChangesRequest,
)
from app.services.commands.base import (
    CommandContext,
    execute_command,
    require_idempotency_key,
)
from app.services.commands.documents import (
    approve_document_command,
    create_document_command,
    needs_changes_document_command,
    request_document_command,
    upload_document_command,
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
async def request_document(
    actor: StaffActor,
    db: DbSession,
    document_id: str,
    idempotency_key: Annotated[str, Depends(require_idempotency_key)],
) -> None:
    await get_document_for_staff(actor, db, document_id)
    await db.rollback()
    async with db.begin():
        context = CommandContext(
            principal_id=actor.id,
            operation="document.request",
            idempotency_key=idempotency_key,
            correlation_id=idempotency_key,
            actor_type="USER",
            actor_id=actor.id,
        )
        await execute_command(
            db,
            context=context,
            payload={"document_id": document_id},
            handler=lambda command: request_document_command(
                db, context=command, document_id=document_id
            ),
        )


@router.post("/documents/{document_id}/approve", status_code=status.HTTP_204_NO_CONTENT)
async def approve_document(
    actor: StaffActor,
    db: DbSession,
    document_id: str,
    idempotency_key: Annotated[str, Depends(require_idempotency_key)],
) -> None:
    await get_document_for_staff(actor, db, document_id)
    await db.rollback()
    async with db.begin():
        context = CommandContext(
            principal_id=actor.id,
            operation="document.approve",
            idempotency_key=idempotency_key,
            correlation_id=idempotency_key,
            actor_type="USER",
            actor_id=actor.id,
        )
        await execute_command(
            db,
            context=context,
            payload={"document_id": document_id},
            handler=lambda command: approve_document_command(
                db, context=command, document_id=document_id
            ),
        )


@router.post(
    "/students/{student_id}/documents",
    response_model=DocumentSummary,
    status_code=status.HTTP_201_CREATED,
)
async def create_document(
    actor: StaffActor,
    db: DbSession,
    student_id: str,
    request: CreateDocumentRequest,
    idempotency_key: Annotated[str, Depends(require_idempotency_key)],
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
    await db.rollback()
    async with db.begin():
        context = CommandContext(
            principal_id=actor.id,
            operation="document.create",
            idempotency_key=idempotency_key,
            correlation_id=idempotency_key,
            actor_type="USER",
            actor_id=actor.id,
        )
        executed = await execute_command(
            db,
            context=context,
            payload=request.model_dump(mode="json"),
            handler=lambda command: create_document_command(
                db, context=command, student_id=student_id, request=request
            ),
        )
    return DocumentSummary.model_validate(executed.result.response)


@router.post("/documents/{document_id}/needs-changes", status_code=status.HTTP_204_NO_CONTENT)
async def needs_changes_document(
    actor: StaffActor,
    db: DbSession,
    document_id: str,
    request: NeedsChangesRequest,
    idempotency_key: Annotated[str, Depends(require_idempotency_key)],
) -> None:
    await get_document_for_staff(actor, db, document_id)
    reason = request.reason.strip()
    if not reason:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail="Reason is required"
        )
    await db.rollback()
    async with db.begin():
        context = CommandContext(
            principal_id=actor.id,
            operation="document.needs_changes",
            idempotency_key=idempotency_key,
            correlation_id=idempotency_key,
            actor_type="USER",
            actor_id=actor.id,
        )
        await execute_command(
            db,
            context=context,
            payload={"document_id": document_id, "reason": reason},
            handler=lambda command: needs_changes_document_command(
                db,
                context=command,
                document_id=document_id,
                reason=reason,
            ),
        )


@router.post("/portal/documents/{document_id}/uploaded", status_code=status.HTTP_204_NO_CONTENT)
async def mark_document_uploaded(
    actor: CurrentActor,
    db: DbSession,
    document_id: str,
    request: DocumentUploadRequest,
    idempotency_key: Annotated[str, Depends(require_idempotency_key)],
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
    await db.rollback()
    async with db.begin():
        context = CommandContext(
            principal_id=actor.id,
            operation="portal.document.upload",
            idempotency_key=idempotency_key,
            correlation_id=idempotency_key,
            actor_type="USER",
            actor_id=actor.id,
        )
        await execute_command(
            db,
            context=context,
            payload={"document_id": document_id, **request.model_dump(mode="json")},
            handler=lambda command: upload_document_command(
                db,
                context=command,
                document_id=document_id,
                request=request,
                curator_id=document.curatorId,
            ),
        )
