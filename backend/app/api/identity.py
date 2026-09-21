from fastapi import APIRouter

from app.core.security import CurrentActor

router = APIRouter(tags=["identity"])


@router.get("/me", summary="Return the actor forwarded by Next.js")
async def current_identity(actor: CurrentActor) -> dict[str, str]:
    return {"id": actor.id, "email": actor.email, "role": actor.role}
