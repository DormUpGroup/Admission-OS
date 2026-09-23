import asyncio
import os
import subprocess
import sys
from pathlib import Path
from uuid import uuid4

from sqlalchemy import text
from sqlalchemy.engine import make_url
from sqlalchemy.ext.asyncio import create_async_engine

from app.core.config import get_settings
from app.db.session import _async_database_url


async def run() -> None:
    database_url = get_settings().database_url
    if not database_url:
        raise RuntimeError("DATABASE_URL is not configured")
    schema = f"migration_rehearsal_{uuid4().hex[:12]}"
    parsed = make_url(database_url)
    query = dict(parsed.query)
    query.pop("schema", None)
    base_url = parsed.set(query=query).render_as_string(hide_password=False)
    rehearsal_url = parsed.set(
        query={**query, "schema": schema}
    ).render_as_string(hide_password=False)
    engine = create_async_engine(_async_database_url(base_url))
    repository = Path(__file__).parents[2]
    try:
        async with engine.begin() as connection:
            await connection.execute(text(f'CREATE SCHEMA "{schema}"'))
        environment = {**os.environ, "DATABASE_URL": rehearsal_url}
        executable = "npx.cmd" if os.name == "nt" else "npx"
        subprocess.run(
            [
                executable,
                "prisma",
                "migrate",
                "deploy",
                "--schema",
                "prisma/schema.prisma",
            ],
            cwd=repository,
            env=environment,
            check=True,
        )
        subprocess.run(
            [sys.executable, "-m", "pytest", "tests/test_schema_contract.py", "-q"],
            cwd=Path(__file__).parents[1],
            env={
                **environment,
                "SCHEMA_CONTRACT_DATABASE_URL": rehearsal_url,
            },
            check=True,
        )
        async with engine.connect() as connection:
            table_count = (
                await connection.execute(
                    text(
                        """
                        SELECT count(*)
                        FROM information_schema.tables
                        WHERE table_schema = :schema
                          AND table_type = 'BASE TABLE'
                        """
                    ),
                    {"schema": schema},
                )
            ).scalar_one()
            rls_count = (
                await connection.execute(
                    text(
                        """
                        SELECT count(*)
                        FROM pg_class c
                        JOIN pg_namespace n ON n.oid = c.relnamespace
                        WHERE n.nspname = :schema AND c.relrowsecurity
                        """
                    ),
                    {"schema": schema},
                )
            ).scalar_one()
        if table_count < 40 or rls_count < 16:
            raise RuntimeError(
                f"Migration rehearsal contract failed: tables={table_count}, "
                f"rls_tables={rls_count}"
            )
        print(f"Migration rehearsal passed: tables={table_count}, rls={rls_count}")
    finally:
        async with engine.begin() as connection:
            await connection.execute(text(f'DROP SCHEMA IF EXISTS "{schema}" CASCADE'))
        await engine.dispose()


if __name__ == "__main__":
    asyncio.run(run())
