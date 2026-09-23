from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import StaffActor
from app.db.session import get_db_session
from app.schemas.operations import RecalculatePreview, RecalculatePreviewRequest
from app.services.operations.readiness import calculate_readiness
from app.services.operations.recalculate import recalculate_student
from app.services.operations.risk import calculate_application_risk

router = APIRouter(tags=["operations"])


@router.post("/operations/recalculate-preview", response_model=RecalculatePreview)
async def recalculate_preview(
    _: StaffActor, request: RecalculatePreviewRequest
) -> RecalculatePreview:
    requirements = [(item.status, item.is_critical) for item in request.requirements]
    return RecalculatePreview(
        readiness_percent=calculate_readiness(status for status, _ in requirements),
        risk_level=calculate_application_risk(
            request.application_status,
            requirements,
            request.hard_deadline,
            request.waiting_days_max,
            request.has_overdue_urgent,
        ),
    )


@router.post("/students/{student_id}/recalculate")
async def persist_student_recalculation(
    _: StaffActor,
    student_id: str,
    db: AsyncSession = Depends(get_db_session),
) -> dict:
    result = await recalculate_student(db, student_id)
    if result is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Student not found"
        )
    await db.commit()
    return result
