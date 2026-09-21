from app.db.session import _async_database_url


def test_adapts_prisma_supabase_url_for_asyncpg() -> None:
    result = _async_database_url(
        "postgresql://postgres:password@example.test:5432/postgres?sslmode=require&connection_limit=5"
    )

    assert result.startswith("postgresql+asyncpg://")
    assert "connection_limit" not in result
    assert "sslmode" not in result
    assert "ssl=require" in result
