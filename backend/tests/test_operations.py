import json
from datetime import datetime
from pathlib import Path

from app.services.operations.readiness import calculate_readiness
from app.services.operations.recalculate import compute_next_action
from app.services.operations.risk import (
    calculate_application_risk,
    calculate_student_risk_from_signals,
)

FIXTURES = json.loads(
    (
        Path(__file__).parents[2] / "tests" / "fixtures" / "derived-state.json"
    ).read_text(encoding="utf-8")
)
NOW = datetime.fromisoformat(FIXTURES["now"].replace("Z", "+00:00"))


def test_shared_readiness_contract() -> None:
    for fixture in FIXTURES["readiness"]:
        assert calculate_readiness(fixture["statuses"]) == fixture["expected"], fixture["name"]


def test_shared_application_risk_contract() -> None:
    for fixture in FIXTURES["applicationRisk"]:
        deadline = (
            datetime.fromisoformat(fixture["hardDeadline"].replace("Z", "+00:00"))
            if fixture["hardDeadline"]
            else None
        )
        requirements = [
            (item["status"], item["isCritical"]) for item in fixture["requirements"]
        ]
        risk = calculate_application_risk(
            fixture["status"],
            requirements,
            deadline,
            fixture["waitingDaysMax"],
            fixture["hasOverdueUrgent"],
            NOW,
        )
        assert risk == fixture["expected"], fixture["name"]


def test_shared_student_risk_contract() -> None:
    for fixture in FIXTURES["studentRisk"]:
        risk = calculate_student_risk_from_signals(
            fixture["applicationRisks"],
            fixture["waitingDaysMax"],
            fixture["hasOverdueUrgent"],
        )
        assert risk == fixture["expected"], fixture["name"]


def test_shared_next_action_contract() -> None:
    for fixture in FIXTURES["nextAction"]:
        input_data = fixture["input"]
        applications = []
        for item in input_data["applications"]:
            application = dict(item)
            application["hardDeadline"] = (
                datetime.fromisoformat(item["hardDeadline"].replace("Z", "+00:00"))
                if item["hardDeadline"]
                else None
            )
            application["programName"] = (item.get("program") or {}).get("name")
            application["universityName"] = (
                (item.get("program") or {}).get("university") or {}
            ).get("name")
            applications.append(application)
        documents = [
            {
                **item,
                "requestedAt": (
                    datetime.fromisoformat(item["requestedAt"].replace("Z", "+00:00"))
                    if item["requestedAt"]
                    else None
                ),
                "uploadedAt": (
                    datetime.fromisoformat(item["uploadedAt"].replace("Z", "+00:00"))
                    if item["uploadedAt"]
                    else None
                ),
            }
            for item in input_data["documents"]
        ]
        tasks = [
            {
                **item,
                "dueDate": (
                    datetime.fromisoformat(item["dueDate"].replace("Z", "+00:00"))
                    if item["dueDate"]
                    else None
                ),
            }
            for item in input_data["tasks"]
        ]
        deadlines = [
            {
                **item,
                "date": datetime.fromisoformat(item["date"].replace("Z", "+00:00")),
            }
            for item in input_data["deadlines"]
        ]
        requirements = {
            item["id"]: item["requirements"] for item in applications
        }
        result = compute_next_action(
            input_data["studentId"],
            applications,
            requirements,
            documents,
            tasks,
            deadlines,
            NOW,
        )
        assert result == fixture["expected"], fixture["name"]
