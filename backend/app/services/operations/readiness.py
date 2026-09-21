from collections.abc import Iterable


def calculate_readiness(statuses: Iterable[str]) -> int:
    applicable = [status for status in statuses if status != "NOT_APPLICABLE"]
    if not applicable:
        return 0
    completed = sum(status == "COMPLETED" for status in applicable)
    return round(completed / len(applicable) * 100)


def critical_incomplete(requirements: Iterable[tuple[str, bool]]) -> bool:
    return any(
        critical and status not in {"COMPLETED", "NOT_APPLICABLE"}
        for status, critical in requirements
    )
