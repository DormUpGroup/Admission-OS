from contextlib import asynccontextmanager

from fastapi import FastAPI

from app.api.applications import router as applications_router
from app.api.catalog import router as catalog_router
from app.api.deadlines import router as deadlines_router
from app.api.documents import router as documents_router
from app.api.health import router as health_router
from app.api.identity import router as identity_router
from app.api.ingestion import router as ingestion_router
from app.api.matching import router as matching_router
from app.api.messages import router as messages_router
from app.api.notifications import router as notifications_router
from app.api.operations import router as operations_router
from app.api.overview import router as overview_router
from app.api.students import router as students_router
from app.api.tasks import router as tasks_router
from app.core.config import get_settings


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
    app.include_router(health_router, prefix="/v1")
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
    return app


app = create_app()
