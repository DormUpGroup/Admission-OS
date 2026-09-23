from pydantic import BaseModel


class AccompanimentNoteRequest(BaseModel):
    note: str | None = None


class IntakeSeatLimitRequest(BaseModel):
    intake: str
    seat_limit: int | None = None
    is_active: bool | None = None
