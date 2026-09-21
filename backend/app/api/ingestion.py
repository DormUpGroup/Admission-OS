from fastapi import APIRouter

from app.core.security import StaffActor
from app.schemas.ingestion import SourceJob, SourcePreview, SourcePreviewRequest
from app.services.ingestion.source import UnsafeSourceUrl, fetch_and_extract_source
from app.workers.tasks import fetch_extract_source

router = APIRouter(tags=["ingestion"])


@router.post("/ingestion/preview", response_model=SourcePreview)
async def preview_source(_: StaffActor, request: SourcePreviewRequest) -> SourcePreview:
    try:
        result = fetch_and_extract_source(str(request.source_url))
    except UnsafeSourceUrl as error:
        from fastapi import HTTPException, status

        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail=str(error),
        ) from error
    return SourcePreview(**result.to_dict())


@router.post("/ingestion/jobs", response_model=SourceJob, status_code=202)
async def enqueue_source(_: StaffActor, request: SourcePreviewRequest) -> SourceJob:
    task = fetch_extract_source.delay(str(request.source_url))
    return SourceJob(job_id=task.id, source_url=str(request.source_url))
