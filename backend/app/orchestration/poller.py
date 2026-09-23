import asyncio
from datetime import UTC, datetime

from sqlalchemy import select, update

from app.db.session import get_session_factory
from app.db.tables import agent_run_table
from app.orchestration.hermes_client import HermesClient

_TERMINAL = {"COMPLETED", "FAILED", "CANCELLED", "TIMED_OUT"}


async def poll_active_hermes_runs(limit: int = 25) -> dict[str, int]:
    factory = get_session_factory()
    async with factory() as db:
        runs = [
            dict(row)
            for row in (
                await db.execute(
                    select(agent_run_table)
                    .where(
                        agent_run_table.c.status.in_(
                            ["STARTING", "QUEUED", "RUNNING"]
                        ),
                        agent_run_table.c.hermesRunId.is_not(None),
                    )
                    .order_by(agent_run_table.c.createdAt)
                    .limit(limit)
                )
            ).mappings()
        ]
    updated = 0
    failed = 0
    client = HermesClient()
    for row in runs:
        try:
            hermes_run = await client.get_run(row["hermesRunId"])
        except Exception as error:
            failed += 1
            async with factory() as db:
                await db.execute(
                    update(agent_run_table)
                    .where(agent_run_table.c.id == row["id"])
                    .values(
                        errorCode=type(error).__name__,
                        errorMessage=str(error)[:2000],
                        updatedAt=datetime.now(UTC),
                    )
                )
                await db.commit()
            continue
        status = hermes_run.status.upper()
        now = datetime.now(UTC)
        async with factory() as db:
            await db.execute(
                update(agent_run_table)
                .where(agent_run_table.c.id == row["id"])
                .values(
                    status=status,
                    hermesSessionId=hermes_run.session_id,
                    outputJson=hermes_run.output,
                    completedAt=now if status in _TERMINAL else None,
                    errorCode=None,
                    errorMessage=None,
                    updatedAt=now,
                )
            )
            await db.commit()
        updated += 1
    return {"checked": len(runs), "updated": updated, "failed": failed}


def poll_active_hermes_runs_sync(limit: int = 25) -> dict[str, int]:
    return asyncio.run(poll_active_hermes_runs(limit))
