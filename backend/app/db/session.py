from collections.abc import AsyncGenerator
from functools import lru_cache

from sqlalchemy.engine import make_url
from sqlalchemy.ext.asyncio import (
    AsyncEngine,
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)

from app.core.config import get_settings


def _async_database_url(database_url: str) -> str:
    """Adapt the Prisma/Supabase PostgreSQL URL for SQLAlchemy + asyncpg.

    Prisma's ``connection_limit`` is a client-side pool setting and asyncpg
    rejects it. Supabase URLs conventionally use libpq's ``sslmode`` spelling;
    asyncpg expects the equivalent ``ssl`` option.
    """
    url = make_url(database_url)
    if url.drivername not in {"postgresql", "postgresql+asyncpg", "postgres"}:
        raise ValueError("DATABASE_URL must use a PostgreSQL URL")
    query = dict(url.query)
    query.pop("connection_limit", None)
    sslmode = query.pop("sslmode", None)
    if sslmode and "ssl" not in query:
        query["ssl"] = sslmode
    return url.set(drivername="postgresql+asyncpg", query=query).render_as_string(
        hide_password=False
    )


@lru_cache
def get_engine() -> AsyncEngine:
    settings = get_settings()
    if not settings.database_url:
        raise RuntimeError("DATABASE_URL is not configured")
    return create_async_engine(
        _async_database_url(settings.database_url),
        pool_pre_ping=True,
        pool_size=5,
        max_overflow=0,
    )


@lru_cache
def get_session_factory() -> async_sessionmaker[AsyncSession]:
    return async_sessionmaker(get_engine(), expire_on_commit=False)


async def get_db_session() -> AsyncGenerator[AsyncSession]:
    async with get_session_factory()() as session:
        yield session
