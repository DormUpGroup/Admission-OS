from contextlib import asynccontextmanager

from fastapi import FastAPI, Request, status
from fastapi.responses import JSONResponse

from app.api.accompaniment import router as accompaniment_router
from app.api.applications import router as applications_router
from app.api.automation import router as automation_router
from app.api.catalog import router as catalog_router
from app.api.deadlines import router as deadlines_router
from app.api.documents import router as documents_router
from app.api.health import router as health_router
from app.api.identity import router as identity_router
from app.api.ingestion import router as ingestion_router
from app.api.matching import router as matching_router
from app.api.mcp import router as mcp_router
from app.api.messages import router as messages_router
from app.api.notifications import router as notifications_router
from app.api.operations import router as operations_router
from app.api.overview import router as overview_router
from app.api.students import router as students_router
from app.api.tasks import router as tasks_router
from app.api.webhooks import router as webhooks_router
from app.core.config import get_settings
from app.services.commands.base import (
    CommandInProgressError,
    IdempotencyConflictError,
)


@asynccontextmanager
async def lifespan(_: FastAPI):
    # Do not open a database connection at import time. This lets local UI work
    # even when the database credentials are intentionally absent.
    yield


def create_app() -> FastAPI:
    settings = get_settings()
    app = FastAPI(
        title=settings.app_name,
        version="0.1.0",
        lifespan=lifespan,
        docs_url="/docs" if settings.app_env != "production" else None,
    )

    @app.exception_handler(IdempotencyConflictError)
    async def idempotency_conflict(
        _: Request, error: IdempotencyConflictError
    ) -> JSONResponse:
        return JSONResponse(
            status_code=status.HTTP_409_CONFLICT,
            content={"detail": str(error)},
        )

    @app.exception_handler(CommandInProgressError)
    async def command_in_progress(
        _: Request, error: CommandInProgressError
    ) -> JSONResponse:
        return JSONResponse(
            status_code=status.HTTP_409_CONFLICT,
            content={"detail": str(error)},
        )

    app.include_router(health_router, prefix="/v1")
    app.include_router(accompaniment_router, prefix="/v1")
    app.include_router(applications_router, prefix="/v1")
    app.include_router(documents_router, prefix="/v1")
    app.include_router(deadlines_router, prefix="/v1")
    app.include_router(identity_router, prefix="/v1")
    app.include_router(catalog_router, prefix="/v1")
    app.include_router(matching_router, prefix="/v1")
    app.include_router(messages_router, prefix="/v1")
    app.include_router(notifications_router, prefix="/v1")
    app.include_router(ingestion_router, prefix="/v1")
    app.include_router(tasks_router, prefix="/v1")
    app.include_router(operations_router, prefix="/v1")
    app.include_router(overview_router, prefix="/v1")
    app.include_router(students_router, prefix="/v1")
    app.include_router(automation_router, prefix="/v1")
    app.include_router(webhooks_router)
    app.include_router(mcp_router)
    return app


app = create_app()
