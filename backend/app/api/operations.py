from fastapi import APIRouter

from app.core.security import StaffActor
from app.schemas.operations import RecalculatePreview, RecalculatePreviewRequest
from app.services.operations.readiness import calculate_readiness
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
