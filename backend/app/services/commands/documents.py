import json
from datetime import UTC, datetime, timedelta
from typing import Any
from uuid import uuid4

from fastapi import HTTPException, status
from sqlalchemy import insert, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.tables import (
    activity_table,
    document_table,
    requirement_table,
    task_table,
)
from app.events.records import append_audit, append_outbox
from app.schemas.documents import CreateDocumentRequest, DocumentUploadRequest
from app.services.commands.base import CommandContext, CommandResult
from app.services.operations.recalculate import recalculate_student


async def _locked_document(db: AsyncSession, document_id: str) -> dict[str, Any]:
    document = (
        await db.execute(
            select(document_table)
            .where(document_table.c.id == document_id)
            .with_for_update()
        )
    ).mappings().first()
    if document is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Document not found"
        )
    return dict(document)


async def _record_document_change(
    db: AsyncSession,
    *,
    context: CommandContext,
    document: dict[str, Any],
    action: str,
    event_type: str,
    activity_type: str,
    after: dict[str, Any],
    now: datetime,
) -> None:
    await db.execute(
        insert(activity_table).values(
            id=uuid4().hex,
            type=activity_type,
            studentId=document["studentId"],
            userId=context.actor_id if context.actor_type == "USER" else None,
            metadata=json.dumps(
                {"name": document["name"], "source": "python-command"}
            ),
            createdAt=now,
        )
    )
    await append_audit(
        db,
        actor_type=context.actor_type,
        actor_id=context.actor_id,
        user_id=context.actor_id if context.actor_type == "USER" else None,
        action=action,
        entity_type="Document",
        entity_id=document["id"],
        correlation_id=context.correlation_id,
        before={
            "status": document["status"],
            "version": document["version"],
        },
        after=after,
        now=now,
    )
    await append_outbox(
        db,
        aggregate_type="Document",
        aggregate_id=document["id"],
        event_type=event_type,
        payload={
            "document_id": document["id"],
            "student_id": document["studentId"],
        },
        idempotency_key=f"{action}:{context.idempotency_key}",
        now=now,
    )
    await recalculate_student(db, document["studentId"], now)


async def create_document_command(
    db: AsyncSession,
    *,
    context: CommandContext,
    student_id: str,
    request: CreateDocumentRequest,
) -> CommandResult:
    now = datetime.now(UTC)
    document_id = uuid4().hex
    name = request.name.strip()
    await db.execute(
        insert(document_table).values(
            id=document_id,
            studentId=student_id,
            name=name,
            category=request.category,
            status="MISSING",
            version=1,
            createdAt=now,
            updatedAt=now,
        )
    )
    await db.execute(
        insert(activity_table).values(
            id=uuid4().hex,
            type="DOCUMENT_CREATED",
            studentId=student_id,
            userId=context.actor_id,
            metadata=json.dumps({"name": name, "source": "python-command"}),
            createdAt=now,
        )
    )
    await append_audit(
        db,
        actor_type=context.actor_type,
        actor_id=context.actor_id,
        user_id=context.actor_id if context.actor_type == "USER" else None,
        action="document.create",
        entity_type="Document",
        entity_id=document_id,
        correlation_id=context.correlation_id,
        after={"status": "MISSING", "name": name, "studentId": student_id},
        now=now,
    )
    await append_outbox(
        db,
        aggregate_type="Document",
        aggregate_id=document_id,
        event_type="document.created.v1",
        payload={"document_id": document_id, "student_id": student_id},
        idempotency_key=f"document:create:{context.idempotency_key}",
        now=now,
    )
    await recalculate_student(db, student_id, now)
    return CommandResult(
        response={
            "id": document_id,
            "student_id": student_id,
            "name": name,
            "category": request.category,
            "status": "MISSING",
            "storage_path": None,
            "uploaded_at": None,
            "reviewed_at": None,
            "requested_at": None,
            "student_feedback": None,
            "file_url": None,
        },
        http_status=status.HTTP_201_CREATED,
        entity_type="Document",
        entity_id=document_id,
    )


async def request_document_command(
    db: AsyncSession,
    *,
    context: CommandContext,
    document_id: str,
) -> CommandResult:
    document = await _locked_document(db, document_id)
    if document["status"] == "APPROVED":
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Approved document cannot be requested again",
        )
    if document["status"] == "REQUESTED":
        return CommandResult(
            response={"id": document_id, "status": "REQUESTED"},
            http_status=status.HTTP_204_NO_CONTENT,
            entity_type="Document",
            entity_id=document_id,
        )
    now = datetime.now(UTC)
    await db.execute(
        update(document_table)
        .where(document_table.c.id == document_id)
        .values(
            status="REQUESTED",
            requestedAt=now,
            studentFeedback=None,
            version=document_table.c.version + 1,
            updatedAt=now,
        )
    )
    await db.execute(
        insert(task_table).values(
            id=uuid4().hex,
            title=f"Upload {document['name']}",
            status="WAITING",
            priority="HIGH",
            assigneeId=context.actor_id,
            studentId=document["studentId"],
            documentId=document_id,
            isStudentFacing=True,
            dueDate=now + timedelta(days=7),
            createdAt=now,
            updatedAt=now,
        )
    )
    await _record_document_change(
        db,
        context=context,
        document=document,
        action="document.request",
        event_type="document.requested.v1",
        activity_type="DOCUMENT_REQUESTED",
        after={"status": "REQUESTED", "version": document["version"] + 1},
        now=now,
    )
    return CommandResult(
        response={"id": document_id, "status": "REQUESTED"},
        http_status=status.HTTP_204_NO_CONTENT,
        entity_type="Document",
        entity_id=document_id,
    )


async def approve_document_command(
    db: AsyncSession,
    *,
    context: CommandContext,
    document_id: str,
) -> CommandResult:
    document = await _locked_document(db, document_id)
    if document["status"] == "APPROVED":
        return CommandResult(
            response={"id": document_id, "status": "APPROVED"},
            http_status=status.HTTP_204_NO_CONTENT,
            entity_type="Document",
            entity_id=document_id,
        )
    now = datetime.now(UTC)
    await db.execute(
        update(document_table)
        .where(document_table.c.id == document_id)
        .values(
            status="APPROVED",
            reviewedAt=now,
            reviewedById=context.actor_id,
            studentFeedback=None,
            version=document_table.c.version + 1,
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
        .values(status="DONE", completedAt=now, updatedAt=now)
    )
    await _record_document_change(
        db,
        context=context,
        document=document,
        action="document.approve",
        event_type="document.approved.v1",
        activity_type="DOCUMENT_APPROVED",
        after={"status": "APPROVED", "version": document["version"] + 1},
        now=now,
    )
    return CommandResult(
        response={"id": document_id, "status": "APPROVED"},
        http_status=status.HTTP_204_NO_CONTENT,
        entity_type="Document",
        entity_id=document_id,
    )


async def needs_changes_document_command(
    db: AsyncSession,
    *,
    context: CommandContext,
    document_id: str,
    reason: str,
) -> CommandResult:
    document = await _locked_document(db, document_id)
    if (
        document["status"] == "NEEDS_CHANGES"
        and document["studentFeedback"] == reason
    ):
        return CommandResult(
            response={"id": document_id, "status": "NEEDS_CHANGES"},
            http_status=status.HTTP_204_NO_CONTENT,
            entity_type="Document",
            entity_id=document_id,
        )
    now = datetime.now(UTC)
    await db.execute(
        update(document_table)
        .where(document_table.c.id == document_id)
        .values(
            status="NEEDS_CHANGES",
            reviewedAt=now,
            reviewedById=context.actor_id,
            studentFeedback=reason,
            requestedAt=now,
            version=document_table.c.version + 1,
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
            title=f"Fix {document['name']}",
            description=reason,
            status="TODO",
            priority="HIGH",
            assigneeId=context.actor_id,
            studentId=document["studentId"],
            documentId=document_id,
            isStudentFacing=True,
            createdAt=now,
            updatedAt=now,
        )
    )
    await _record_document_change(
        db,
        context=context,
        document=document,
        action="document.needs_changes",
        event_type="document.needs_changes.v1",
        activity_type="DOCUMENT_NEEDS_CHANGES",
        after={
            "status": "NEEDS_CHANGES",
            "version": document["version"] + 1,
            "reason": reason,
        },
        now=now,
    )
    return CommandResult(
        response={"id": document_id, "status": "NEEDS_CHANGES"},
        http_status=status.HTTP_204_NO_CONTENT,
        entity_type="Document",
        entity_id=document_id,
    )


async def upload_document_command(
    db: AsyncSession,
    *,
    context: CommandContext,
    document_id: str,
    request: DocumentUploadRequest,
    curator_id: str | None,
) -> CommandResult:
    document = await _locked_document(db, document_id)
    if (
        document["status"] == "UPLOADED"
        and document["storagePath"] == request.storage_path
    ):
        return CommandResult(
            response={"id": document_id, "status": "UPLOADED"},
            http_status=status.HTTP_204_NO_CONTENT,
            entity_type="Document",
            entity_id=document_id,
        )
    now = datetime.now(UTC)
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
            version=document_table.c.version + 1,
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
            title=f"Review {document['name']}",
            status="TODO",
            priority="HIGH",
            assigneeId=curator_id,
            studentId=document["studentId"],
            documentId=document_id,
            isStudentFacing=False,
            createdAt=now,
            updatedAt=now,
        )
    )
    await _record_document_change(
        db,
        context=context,
        document=document,
        action="document.upload",
        event_type="document.uploaded.v1",
        activity_type="DOCUMENT_UPLOADED",
        after={"status": "UPLOADED", "version": document["version"] + 1},
        now=now,
    )
    return CommandResult(
        response={"id": document_id, "status": "UPLOADED"},
        http_status=status.HTTP_204_NO_CONTENT,
        entity_type="Document",
        entity_id=document_id,
    )
