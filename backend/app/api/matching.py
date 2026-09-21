from fastapi import APIRouter

from app.core.security import StaffActor
from app.schemas.matching import EligibilityRequest, EligibilityResponse
from app.services.matching.eligibility import evaluate_eligibility

router = APIRouter(tags=["matching"])


@router.post("/matching/evaluate-eligibility", response_model=EligibilityResponse)
async def evaluate_match_eligibility(
    _: StaffActor, request: EligibilityRequest
) -> EligibilityResponse:
    """Evaluate the first Python-ported matching rule set without persisting data."""
    return evaluate_eligibility(request)
