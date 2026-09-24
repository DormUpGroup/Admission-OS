from fastapi import APIRouter, HTTPException, status
from starlette.concurrency import run_in_threadpool

from app.core.security import StaffActor
from app.schemas.ingestion import SourceJob, SourcePreview, SourcePreviewRequest
from app.services.ingestion.source import (
    SourceRedirectError,
    SourceTooLarge,
    UnsafeSourceUrl,
    UnsupportedSourceType,
    fetch_and_extract_source,
    validate_source_url,
)
from app.workers.tasks import fetch_extract_source

router = APIRouter(tags=["ingestion"])


def _map_source_error(error: Exception) -> HTTPException:
    if isinstance(error, UnsafeSourceUrl):
        return HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail=str(error),
        )
    if isinstance(error, UnsupportedSourceType):
        return HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail=str(error),
        )
    if isinstance(error, SourceTooLarge):
        return HTTPException(
            status_code=status.HTTP_413_CONTENT_TOO_LARGE,
            detail=str(error),
        )
    if isinstance(error, SourceRedirectError):
        return HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail=str(error),
        )
    raise error


@router.post("/ingestion/preview", response_model=SourcePreview)
async def preview_source(_: StaffActor, request: SourcePreviewRequest) -> SourcePreview:
    try:
        result = await run_in_threadpool(
            fetch_and_extract_source, str(request.source_url)
        )
    except (
        UnsafeSourceUrl,
        UnsupportedSourceType,
        SourceTooLarge,
        SourceRedirectError,
    ) as error:
        raise _map_source_error(error) from error
    return SourcePreview(**result.to_dict())


@router.post("/ingestion/jobs", response_model=SourceJob, status_code=202)
async def enqueue_source(_: StaffActor, request: SourcePreviewRequest) -> SourceJob:
    source_url = str(request.source_url)
    try:
        validate_source_url(source_url)
    except UnsafeSourceUrl as error:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail=str(error),
        ) from error
    task = fetch_extract_source.delay(source_url)
    return SourceJob(job_id=task.id, source_url=source_url)
