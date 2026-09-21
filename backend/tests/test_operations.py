from datetime import UTC, datetime, timedelta

from app.services.operations.readiness import calculate_readiness
from app.services.operations.risk import calculate_application_risk


def test_readiness_ignores_not_applicable_requirements() -> None:
    assert calculate_readiness(["COMPLETED", "NOT_APPLICABLE", "MISSING"]) == 50


def test_critical_deadline_becomes_critical_risk() -> None:
    risk = calculate_application_risk(
        "PREPARING",
        [("MISSING", True)],
        datetime.now(UTC) + timedelta(days=1),
    )
    assert risk == "CRITICAL"
