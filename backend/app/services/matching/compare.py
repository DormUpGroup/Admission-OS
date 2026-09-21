import re
from datetime import UTC, datetime
from typing import Literal

RequirementStatus = Literal["MET", "NOT_MET", "UNKNOWN"]
UNKNOWN = "UNKNOWN"
_CEFR_RANK = {"A1": 1, "A2": 2, "B1": 3, "B2": 4, "C1": 5, "C2": 6}


def is_unknown(value: object) -> bool:
    return value is None or value == "" or value == UNKNOWN


def compare_numeric_requirement(
    student_value: int | float | str | None,
    operator: str | None,
    required: int | float | None,
) -> RequirementStatus:
    if required is None or is_unknown(student_value) or not isinstance(student_value, (int, float)):
        return "UNKNOWN"
    match operator or ">=":
        case ">=":
            return "MET" if student_value >= required else "NOT_MET"
        case ">":
            return "MET" if student_value > required else "NOT_MET"
        case "<=":
            return "MET" if student_value <= required else "NOT_MET"
        case "<":
            return "MET" if student_value < required else "NOT_MET"
        case "=" | "==":
            return "MET" if student_value == required else "NOT_MET"
        case _:
            return "UNKNOWN"


def parse_cefr(value: str | None) -> str | None:
    if not value:
        return None
    match = re.search(r"\b([ABC][12])\b", value.upper())
    return match.group(1) if match else None


def compare_language_level(
    student_level: str | None, required_level: str | None
) -> RequirementStatus:
    required = parse_cefr(required_level)
    actual = parse_cefr(student_level)
    if not required or not actual or is_unknown(student_level):
        return "UNKNOWN"
    return "MET" if _CEFR_RANK[actual] >= _CEFR_RANK[required] else "NOT_MET"


def deadline_status(deadline: datetime | str | None, now: datetime | None = None) -> str:
    if deadline is None:
        return "UNKNOWN"
    try:
        parsed = (
            datetime.fromisoformat(deadline.replace("Z", "+00:00"))
            if isinstance(deadline, str)
            else deadline
        )
    except ValueError:
        return "UNKNOWN"
    now = now or datetime.now(UTC)
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=UTC)
    if parsed < now:
        return "PASSED"
    return "SOON" if (parsed - now).total_seconds() <= 21 * 86_400 else "OPEN"


def previous_academic_year(year: str) -> str | None:
    match = re.fullmatch(r"(\d{4})\s*/\s*(\d{4})", year)
    if not match:
        return None
    return f"{int(match.group(1)) - 1}/{int(match.group(2)) - 1}"
