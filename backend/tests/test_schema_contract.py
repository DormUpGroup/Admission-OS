import os

import pytest
from sqlalchemy import (
    JSON,
    Boolean,
    DateTime,
    Integer,
    Numeric,
    String,
    Text,
    inspect,
)
from sqlalchemy.engine import make_url
from sqlalchemy.ext.asyncio import create_async_engine

from app.db.session import _async_database_url
from app.db.tables import metadata


def _type_family(value) -> type:
    if isinstance(value, (String, Text)):
        return str
    for family in (Boolean, Integer, Numeric, DateTime, JSON):
        if isinstance(value, family):
            return family
    return type(value)


async def test_sqlalchemy_read_model_matches_migrated_prisma_schema() -> None:
    database_url = os.getenv("SCHEMA_CONTRACT_DATABASE_URL")
    if not database_url:
        pytest.skip("SCHEMA_CONTRACT_DATABASE_URL is not configured")
    parsed = make_url(database_url.strip().strip("\"'"))
    schema = parsed.query.get("schema", "public")
    query = dict(parsed.query)
    query.pop("schema", None)
    connection_url = parsed.set(query=query).render_as_string(hide_password=False)
    engine = create_async_engine(_async_database_url(connection_url))

    def inspect_contract(connection) -> list[str]:
        inspector = inspect(connection)
        errors: list[str] = []
        actual_tables = set(inspector.get_table_names(schema=schema))
        for table in metadata.sorted_tables:
            if table.name not in actual_tables:
                errors.append(f"{table.name}: table is missing")
                continue
            actual_columns = {
                column["name"]: column
                for column in inspector.get_columns(table.name, schema=schema)
            }
            for column in table.columns:
                actual = actual_columns.get(column.name)
                if actual is None:
                    errors.append(f"{table.name}.{column.name}: column is missing")
                    continue
                if column.nullable != actual["nullable"]:
                    errors.append(
                        f"{table.name}.{column.name}: nullable is "
                        f"{actual['nullable']}, expected {column.nullable}"
                    )
                if _type_family(column.type) is not _type_family(actual["type"]):
                    errors.append(
                        f"{table.name}.{column.name}: type is {actual['type']}, "
                        f"expected {column.type}"
                    )
            actual_fks = {
                (tuple(item["constrained_columns"]), item["referred_table"])
                for item in inspector.get_foreign_keys(table.name, schema=schema)
            }
            for column in table.columns:
                for foreign_key in column.foreign_keys:
                    expected = ((column.name,), foreign_key.column.table.name)
                    if expected not in actual_fks:
                        errors.append(
                            f"{table.name}.{column.name}: foreign key to "
                            f"{foreign_key.column.table.name} is missing"
                        )
        return errors

    try:
        async with engine.connect() as connection:
            errors = await connection.run_sync(inspect_contract)
    finally:
        await engine.dispose()
    assert not errors, "\n".join(errors)
