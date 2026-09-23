from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.db.tables import metadata, student_table
from app.schemas.students import CreateStudentRequest
from app.services.commands import students as student_commands
from app.services.commands.base import CommandContext, execute_command
from app.services.commands.students import create_student_command


async def _database():
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    async with engine.begin() as connection:
        await connection.run_sync(metadata.create_all)
    return engine, async_sessionmaker(engine, expire_on_commit=False)


def _context() -> CommandContext:
    return CommandContext(
        principal_id="curator_1",
        operation="student.create",
        idempotency_key="student-create-0001",
        correlation_id="student-create-0001",
        actor_type="USER",
        actor_id="curator_1",
    )


async def test_audit_fault_rolls_back_the_whole_command(monkeypatch) -> None:
    engine, factory = await _database()

    async def boom(*_args, **_kwargs):
        raise RuntimeError("audit fault injection")

    monkeypatch.setattr(student_commands, "append_audit", boom)
    request = CreateStudentRequest(
        first_name="Ada",
        last_name="Lovelace",
        email="ada@example.test",
        intake="2027/28",
        curator_id="curator_1",
    )
    try:
        async with factory() as db:
            async with db.begin():
                await execute_command(
                    db,
                    context=_context(),
                    payload=request.model_dump(mode="json"),
                    handler=lambda command: create_student_command(
                        db, context=command, request=request
                    ),
                )
    except RuntimeError:
        pass
    async with factory() as db:
        count = (
            await db.execute(select(func.count()).select_from(student_table))
        ).scalar_one()
    assert count == 0
    await engine.dispose()


async def test_recalculate_fault_rolls_back_the_whole_command(monkeypatch) -> None:
    engine, factory = await _database()

    async def boom(*_args, **_kwargs):
        raise RuntimeError("recalculate fault injection")

    monkeypatch.setattr(
        "app.services.commands.students.recalculate_student", boom
    )
    request = CreateStudentRequest(
        first_name="Ada",
        last_name="Lovelace",
        email="ada@example.test",
        intake="2027/28",
    )
    try:
        async with factory() as db:
            async with db.begin():
                await execute_command(
                    db,
                    context=_context(),
                    payload=request.model_dump(mode="json"),
                    handler=lambda command: create_student_command(
                        db, context=command, request=request
                    ),
                )
    except RuntimeError:
        pass
    async with factory() as db:
        count = (
            await db.execute(select(func.count()).select_from(student_table))
        ).scalar_one()
    assert count == 0
    await engine.dispose()
