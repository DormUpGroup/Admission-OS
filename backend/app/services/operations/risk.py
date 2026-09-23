from datetime import UTC, datetime

from app.services.operations.readiness import critical_incomplete

RISK_RANK = {"NONE": 0, "LOW": 1, "MEDIUM": 2, "HIGH": 3, "CRITICAL": 4}
CLOSED_APPLICATION_STATUSES = {
    "SUBMITTED",
    "WAITING_RESULT",
    "ADMITTED",
    "REJECTED",
    "WAITLISTED",
    "ENROLLED",
    "NOT_SELECTED",
}


def _days_until(deadline: datetime | None, now: datetime) -> int | None:
    if deadline is None:
        return None
    if deadline.tzinfo is None:
        deadline = deadline.replace(tzinfo=UTC)
    return (deadline.date() - now.date()).days


def calculate_application_risk(
    application_status: str,
    requirements: list[tuple[str, bool]],
    hard_deadline: datetime | None,
    waiting_days_max: int = 0,
    has_overdue_urgent: bool = False,
    now: datetime | None = None,
) -> str:
    if application_status in CLOSED_APPLICATION_STATUSES:
        return "NONE"
    now = now or datetime.now(UTC)
    days_left = _days_until(hard_deadline, now)
    has_blocker = critical_incomplete(requirements)
    incomplete = any(status not in {"COMPLETED", "NOT_APPLICABLE"} for status, _ in requirements)
    level = "NONE"

    def raise_to(candidate: str) -> None:
        nonlocal level
        if RISK_RANK[candidate] > RISK_RANK[level]:
            level = candidate

    if days_left is not None and days_left <= 2 and has_blocker:
        raise_to("CRITICAL")
    if (
        (days_left is not None and days_left <= 7 and has_blocker)
        or waiting_days_max >= 9
        or has_overdue_urgent
    ):
        raise_to("HIGH")
    if (days_left is not None and days_left <= 14 and incomplete) or waiting_days_max > 5:
        raise_to("MEDIUM")
    if incomplete:
        raise_to("LOW")
    return level


def calculate_student_risk_from_signals(
    application_risks: list[str],
    waiting_days_max: int,
    has_overdue_urgent: bool,
) -> str:
    waiting_risk = (
        "HIGH"
        if waiting_days_max >= 9
        else "MEDIUM"
        if waiting_days_max >= 6
        else "LOW"
        if waiting_days_max >= 3
        else "NONE"
    )
    levels = [*application_risks, waiting_risk]
    if has_overdue_urgent:
        levels.append("HIGH")
    return max(levels or ["NONE"], key=RISK_RANK.__getitem__)
