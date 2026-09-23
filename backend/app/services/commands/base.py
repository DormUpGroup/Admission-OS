import hashlib
import json
import re
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Annotated, Any
from uuid import uuid4

from fastapi import Header, HTTPException, status
from sqlalchemy import insert, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.tables import command_execution_table

_KEY_PATTERN = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$")


def require_idempotency_key(
    value: Annotated[str | None, Header(alias="Idempotency-Key")] = None,
) -> str:
    if value is None or not _KEY_PATTERN.fullmatch(value):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=(
                "Idempotency-Key is required and must be 8-128 characters "
                "using letters, digits, dot, underscore, colon, or dash"
            ),
        )
    return value


IdempotencyKey = Annotated[str, Header(alias="Idempotency-Key")]


@dataclass(frozen=True)
class CommandContext:
    principal_id: str
    operation: str
    idempotency_key: str
    correlation_id: str
    actor_type: str
    actor_id: str


@dataclass(frozen=True)
class CommandResult:
    response: dict[str, Any]
    http_status: int = 200
    entity_type: str | None = None
    entity_id: str | None = None


@dataclass(frozen=True)
class ExecutedCommand:
    result: CommandResult
    replayed: bool


class IdempotencyConflictError(ValueError):
    pass


class CommandInProgressError(RuntimeError):
    pass


CommandHandler = Callable[[CommandContext], Awaitable[CommandResult]]


def user_context(
    *,
    user_id: str,
    operation: str,
    idempotency_key: str,
    correlation_id: str | None = None,
) -> CommandContext:
    return CommandContext(
        principal_id=user_id,
        operation=operation,
        idempotency_key=idempotency_key,
        correlation_id=correlation_id or idempotency_key,
        actor_type="USER",
        actor_id=user_id,
    )


def agent_context(
    *,
    agent_run_id: str,
    operation: str,
    idempotency_key: str,
    actor_id: str | None = None,
    correlation_id: str | None = None,
) -> CommandContext:
    return CommandContext(
        principal_id=f"agent:{agent_run_id}",
        operation=operation,
        idempotency_key=idempotency_key,
        correlation_id=correlation_id or idempotency_key,
        actor_type="AGENT",
        actor_id=actor_id or agent_run_id,
    )


def system_context(
    *,
    operation: str,
    idempotency_key: str,
    principal_id: str = "system:automation",
    actor_id: str = "automation",
    correlation_id: str | None = None,
) -> CommandContext:
    return CommandContext(
        principal_id=principal_id,
        operation=operation,
        idempotency_key=idempotency_key,
        correlation_id=correlation_id or idempotency_key,
        actor_type="SYSTEM",
        actor_id=actor_id,
    )


def jsonable(value: Any) -> Any:
    return json.loads(json.dumps(value, default=str, ensure_ascii=False))


def request_hash(payload: dict[str, Any]) -> str:
    canonical = json.dumps(
        payload,
        sort_keys=True,
        separators=(",", ":"),
        ensure_ascii=False,
        default=str,
    )
    return hashlib.sha256(canonical.encode()).hexdigest()


async def _locked_execution(
    db: AsyncSession, context: CommandContext
) -> dict[str, Any] | None:
    return (
        await db.execute(
            select(command_execution_table)
            .where(
                command_execution_table.c.principalId == context.principal_id,
                command_execution_table.c.operation == context.operation,
                command_execution_table.c.idempotencyKey
                == context.idempotency_key,
            )
            .with_for_update()
        )
    ).mappings().first()


async def execute_command(
    db: AsyncSession,
    *,
    context: CommandContext,
    payload: dict[str, Any],
    handler: CommandHandler,
) -> ExecutedCommand:
    digest = request_hash(payload)
    execution = await _locked_execution(db, context)
    if execution is None:
        now = datetime.now(UTC)
        insert_statement = insert(command_execution_table).values(
            id=uuid4().hex,
            principalId=context.principal_id,
            operation=context.operation,
            idempotencyKey=context.idempotency_key,
            requestHash=digest,
            status="PENDING",
            correlationId=context.correlation_id,
            createdAt=now,
            updatedAt=now,
        )
        if db.bind and db.bind.dialect.name == "sqlite":
            await db.execute(insert_statement)
            execution = await _locked_execution(db, context)
        else:
            try:
                async with db.begin_nested():
                    await db.execute(insert_statement)
                    await db.flush()
            except IntegrityError:
                execution = await _locked_execution(db, context)
            else:
                execution = await _locked_execution(db, context)
    if execution is None:
        raise CommandInProgressError("Command receipt could not be acquired")
    if execution["requestHash"] != digest:
        from app.observability.metrics import incr

        incr("command_conflict", operation=context.operation)
        raise IdempotencyConflictError(
            "Idempotency-Key was already used with a different request payload"
        )
    if execution["status"] == "COMPLETED":
        from app.observability.metrics import incr

        incr("command_replay", operation=context.operation)
        return ExecutedCommand(
            CommandResult(
                response=dict(execution["responseJson"] or {}),
                http_status=execution["httpStatus"] or 200,
                entity_type=execution["entityType"],
                entity_id=execution["entityId"],
            ),
            replayed=True,
        )
    if execution["status"] != "PENDING":
        raise CommandInProgressError(
            f"Command is not executable from status {execution['status']}"
        )

    result: CommandResult = await handler(context)
    completed_at = datetime.now(UTC)
    await db.execute(
        update(command_execution_table)
        .where(
            command_execution_table.c.principalId == context.principal_id,
            command_execution_table.c.operation == context.operation,
            command_execution_table.c.idempotencyKey == context.idempotency_key,
        )
        .values(
            status="COMPLETED",
            responseJson=jsonable(result.response),
            httpStatus=result.http_status,
            entityType=result.entity_type,
            entityId=result.entity_id,
            completedAt=completed_at,
            updatedAt=completed_at,
        )
    )
    return ExecutedCommand(result, replayed=False)
