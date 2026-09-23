import asyncio

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.db.tables import command_execution_table, metadata
from app.services.commands.base import (
    CommandContext,
    CommandResult,
    IdempotencyConflictError,
    execute_command,
)


async def _database():
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    async with engine.begin() as connection:
        await connection.run_sync(metadata.create_all)
    return engine, async_sessionmaker(engine, expire_on_commit=False)


def _context() -> CommandContext:
    return CommandContext(
        principal_id="user_1",
        operation="test.create",
        idempotency_key="command-key-0001",
        correlation_id="command-key-0001",
        actor_type="USER",
        actor_id="user_1",
    )


async def test_completed_command_replays_saved_result_without_handler() -> None:
    engine, factory = await _database()
    calls = 0

    async def handler(_: CommandContext) -> CommandResult:
        nonlocal calls
        calls += 1
        return CommandResult(
            {"id": "entity_1", "status": "CREATED"},
            http_status=201,
            entity_type="TestEntity",
            entity_id="entity_1",
        )

    async with factory() as db:
        async with db.begin():
            first = await execute_command(
                db, context=_context(), payload={"name": "A"}, handler=handler
            )
    async with factory() as db:
        async with db.begin():
            replay = await execute_command(
                db, context=_context(), payload={"name": "A"}, handler=handler
            )

    assert calls == 1
    assert first.replayed is False
    assert replay.replayed is True
    assert replay.result.response == first.result.response
    await engine.dispose()


async def test_same_key_with_different_payload_conflicts() -> None:
    engine, factory = await _database()

    async def handler(_: CommandContext) -> CommandResult:
        return CommandResult({"ok": True})

    async with factory() as db:
        async with db.begin():
            await execute_command(
                db, context=_context(), payload={"name": "A"}, handler=handler
            )
    try:
        async with factory() as db:
            async with db.begin():
                await execute_command(
                    db, context=_context(), payload={"name": "B"}, handler=handler
                )
    except IdempotencyConflictError:
        pass
    else:
        raise AssertionError("Expected an idempotency conflict")
    await engine.dispose()


async def test_parallel_replays_do_not_reexecute_completed_handler() -> None:
    engine, factory = await _database()
    calls = 0

    async def handler(_: CommandContext) -> CommandResult:
        nonlocal calls
        calls += 1
        return CommandResult({"id": "entity_1"})

    async with factory() as db:
        async with db.begin():
            await execute_command(
                db, context=_context(), payload={"name": "A"}, handler=handler
            )

    async def replay() -> bool:
        async with factory() as db:
            async with db.begin():
                executed = await execute_command(
                    db, context=_context(), payload={"name": "A"}, handler=handler
                )
        return executed.replayed

    first, second = await asyncio.gather(replay(), replay())
    assert calls == 1
    assert first is True
    assert second is True
    await engine.dispose()


async def test_failed_command_rolls_back_receipt_with_transaction() -> None:
    engine, factory = await _database()

    async def handler(_: CommandContext) -> CommandResult:
        raise RuntimeError("fault injection")

    try:
        async with factory() as db:
            async with db.begin():
                await execute_command(
                    db, context=_context(), payload={"name": "A"}, handler=handler
                )
    except RuntimeError:
        pass
    async with factory() as db:
        count = (
            await db.execute(select(func.count()).select_from(command_execution_table))
        ).scalar_one()
    assert count == 0
    await engine.dispose()
