from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.tables import (
    application_table,
    conversation_message_table,
    conversation_table,
    document_table,
    lead_table,
    task_table,
)
from app.mcp.principal import McpPrincipal


class ResourceAuthorizationError(PermissionError):
    """Resource is outside the verified AgentRun bindings."""


def _deny(message: str = "Resource is outside agent run context") -> None:
    raise ResourceAuthorizationError(message)


async def assert_conversation_access(
    db: AsyncSession, principal: McpPrincipal, conversation_id: str
) -> None:
    if principal.conversation_id:
        if principal.conversation_id != conversation_id:
            _deny()
        return
    conversation = (
        await db.execute(
            select(conversation_table).where(conversation_table.c.id == conversation_id)
        )
    ).mappings().first()
    if conversation is None:
        _deny("Conversation not found")
    if principal.lead_id and conversation.leadId == principal.lead_id:
        return
    if principal.student_id and conversation.studentId == principal.student_id:
        return
    _deny()


async def assert_lead_access(
    db: AsyncSession, principal: McpPrincipal, lead_id: str
) -> None:
    if principal.lead_id:
        if principal.lead_id != lead_id:
            _deny()
        return
    if principal.conversation_id:
        conversation = (
            await db.execute(
                select(conversation_table).where(
                    conversation_table.c.id == principal.conversation_id
                )
            )
        ).mappings().first()
        if conversation is None or conversation.leadId != lead_id:
            _deny()
        return
    if principal.student_id:
        lead = (
            await db.execute(select(lead_table).where(lead_table.c.id == lead_id))
        ).mappings().first()
        if lead is None or lead.convertedStudentId != principal.student_id:
            _deny()
        return
    _deny()


async def assert_student_access(
    db: AsyncSession, principal: McpPrincipal, student_id: str
) -> None:
    if principal.student_id:
        if principal.student_id != student_id:
            _deny()
        return
    if principal.conversation_id:
        conversation = (
            await db.execute(
                select(conversation_table).where(
                    conversation_table.c.id == principal.conversation_id
                )
            )
        ).mappings().first()
        if conversation is None or conversation.studentId != student_id:
            _deny()
        return
    if principal.lead_id:
        lead = (
            await db.execute(
                select(lead_table).where(lead_table.c.id == principal.lead_id)
            )
        ).mappings().first()
        if lead is None or lead.convertedStudentId != student_id:
            _deny()
        return
    _deny()


async def assert_message_access(
    db: AsyncSession, principal: McpPrincipal, message_id: str
) -> None:
    message = (
        await db.execute(
            select(conversation_message_table).where(
                conversation_message_table.c.id == message_id
            )
        )
    ).mappings().first()
    if message is None:
        _deny("Message not found")
    await assert_conversation_access(db, principal, message.conversationId)


async def assert_document_access(
    db: AsyncSession, principal: McpPrincipal, document_id: str
) -> None:
    document = (
        await db.execute(
            select(document_table).where(document_table.c.id == document_id)
        )
    ).mappings().first()
    if document is None:
        _deny("Document not found")
    await assert_student_access(db, principal, document.studentId)


async def assert_application_access(
    db: AsyncSession, principal: McpPrincipal, application_id: str
) -> None:
    application = (
        await db.execute(
            select(application_table).where(application_table.c.id == application_id)
        )
    ).mappings().first()
    if application is None:
        _deny("Application not found")
    await assert_student_access(db, principal, application.studentId)


async def assert_task_access(
    db: AsyncSession, principal: McpPrincipal, task_id: str
) -> None:
    task = (
        await db.execute(select(task_table).where(task_table.c.id == task_id))
    ).mappings().first()
    if task is None:
        _deny("Task not found")
    await assert_student_access(db, principal, task.studentId)


async def assert_optional_bindings(
    db: AsyncSession,
    principal: McpPrincipal,
    *,
    lead_id: str | None = None,
    student_id: str | None = None,
    conversation_id: str | None = None,
    application_id: str | None = None,
) -> None:
    if lead_id:
        await assert_lead_access(db, principal, lead_id)
    if student_id:
        await assert_student_access(db, principal, student_id)
    if conversation_id:
        await assert_conversation_access(db, principal, conversation_id)
    if application_id:
        await assert_application_access(db, principal, application_id)
