from fastapi import APIRouter, HTTPException, status
from sqlalchemy import text

from app.core.config import get_settings
from app.db.session import get_engine

router = APIRouter(tags=["system"])


@router.get("/health", summary="Liveness check")
async def health() -> dict[str, str]:
    return {"status": "ok"}


@router.get("/health/ready", summary="Database readiness check")
async def readiness() -> dict[str, str]:
    settings = get_settings()
    if not settings.has_database:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="DATABASE_URL is not configured",
        )

    try:
        async with get_engine().connect() as connection:
            await connection.execute(text("SELECT 1"))
    except Exception as error:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Database is unavailable",
        ) from error

    return {"status": "ok", "database": "ok"}
