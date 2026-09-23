import json
from datetime import UTC, datetime
from typing import Any

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.tables import (
    application_table,
    deadline_table,
    document_table,
    program_table,
    requirement_table,
    student_table,
    task_table,
    university_table,
)
from app.services.operations.readiness import calculate_readiness
from app.services.operations.risk import (
    calculate_application_risk,
    calculate_student_risk_from_signals,
)

_CLOSED_NEXT_ACTION_STATUSES = {
    "SUBMITTED",
    "ADMITTED",
    "REJECTED",
    "ENROLLED",
    "NOT_SELECTED",
}


def _utc(value: datetime | None) -> datetime | None:
    if value is None:
        return None
    return value if value.tzinfo else value.replace(tzinfo=UTC)


def _days_until(value: datetime | None, now: datetime) -> int | None:
    value = _utc(value)
    return None if value is None else (value.date() - now.date()).days


def _days_waiting(value: datetime | None, now: datetime) -> int:
    value = _utc(value)
    return 0 if value is None else max(0, (now.date() - value.date()).days)


def _iso(value: datetime) -> str:
    aware = _utc(value)
    assert aware is not None
    return aware.isoformat(timespec="milliseconds").replace("+00:00", "Z")


def compute_next_action(
    student_id: str,
    applications: list[dict[str, Any]],
    requirements_by_application: dict[str, list[dict[str, Any]]],
    documents: list[dict[str, Any]],
    tasks: list[dict[str, Any]],
    deadlines: list[dict[str, Any]],
    now: datetime,
) -> dict[str, Any]:
    candidates: list[dict[str, Any]] = []

    for application in applications:
        if application["status"] in _CLOSED_NEXT_ACTION_STATUSES:
            continue
        blockers = [
            item
            for item in requirements_by_application.get(application["id"], [])
            if item["isCritical"]
            and item["status"] not in {"COMPLETED", "NOT_APPLICABLE"}
        ]
        days_left = _days_until(application["hardDeadline"], now)
        if blockers and days_left is not None and days_left <= 14:
            blocker = blockers[0]
            university_name = application.get("universityName") or "Подача"
            program_name = application.get("programName")
            candidates.append(
                {
                    "title": f"Не хватает: {blocker['name']}",
                    "description": (
                        f"Нужно для {university_name}"
                        f"{f' — {program_name}' if program_name else ''}."
                        f" Дедлайн через {max(0, days_left)} дн."
                    ),
                    "priority": 1,
                    "kind": "CRITICAL_BLOCKER",
                    "studentId": student_id,
                    "applicationId": application["id"],
                    "documentId": blocker["relatedDocumentId"],
                    "dueDate": (
                        _iso(application["hardDeadline"])
                        if application["hardDeadline"]
                        else None
                    ),
                }
            )

    for task in tasks:
        due_date = _utc(task["dueDate"])
        if task["status"] != "DONE" and due_date and due_date < now:
            candidates.append(
                {
                    "title": f"Просрочено: {task['title']}",
                    "description": "Срок задачи истёк — нужно выполнить.",
                    "priority": 2,
                    "kind": "OVERDUE_TASK",
                    "studentId": student_id,
                    "applicationId": task["applicationId"],
                    "taskId": task["id"],
                    "dueDate": _iso(due_date),
                }
            )

    for document in documents:
        if document["status"] in {"UPLOADED", "UNDER_REVIEW"}:
            candidates.append(
                {
                    "title": f"Проверить: {document['name']}",
                    "description": "Документ загружен и ждёт проверки куратора.",
                    "priority": 3,
                    "kind": "DOCUMENT_REVIEW",
                    "studentId": student_id,
                    "documentId": document["id"],
                }
            )
        elif document["status"] in {"REQUESTED", "NEEDS_CHANGES"}:
            candidates.append(
                {
                    "title": f"Ожидание: {document['name']}",
                    "description": (
                        f"Студент не ответил "
                        f"{_days_waiting(document['requestedAt'], now)} дн."
                    ),
                    "priority": 4,
                    "kind": "WAITING_ON_STUDENT",
                    "studentId": student_id,
                    "documentId": document["id"],
                }
            )

    for deadline in deadlines:
        if deadline["isInternal"]:
            continue
        days_left = _days_until(deadline["date"], now)
        if days_left is not None and 0 <= days_left <= 14:
            candidates.append(
                {
                    "title": deadline["title"],
                    "description": f"Ближайший дедлайн через {days_left} дн.",
                    "priority": 5,
                    "kind": "UPCOMING_DEADLINE",
                    "studentId": student_id,
                    "applicationId": deadline["applicationId"],
                    "dueDate": _iso(deadline["date"]),
                }
            )

    for task in tasks:
        if task["status"] in {"DONE", "BLOCKED"}:
            continue
        candidates.append(
            {
                "title": task["title"],
                "description": "Следующая задача в очереди.",
                "priority": 6,
                "kind": "NORMAL_TASK",
                "studentId": student_id,
                "applicationId": task["applicationId"],
                "taskId": task["id"],
                "dueDate": _iso(task["dueDate"]) if task["dueDate"] else None,
            }
        )

    if not candidates:
        return {
            "title": "Нет срочных действий",
            "description": "Все текущие шаги выполнены или ожидают внешнего события.",
            "priority": 99,
            "kind": "NONE",
            "studentId": student_id,
        }
    return min(candidates, key=lambda item: item["priority"])


async def recalculate_student(
    db: AsyncSession, student_id: str, now: datetime | None = None
) -> dict[str, Any] | None:
    """Persist readiness, risk, and next action inside the Python command boundary."""
    now = now or datetime.now(UTC)
    student = (
        await db.execute(select(student_table).where(student_table.c.id == student_id))
    ).mappings().first()
    if student is None:
        return None

    applications = [
        dict(row)
        for row in (
            await db.execute(
                select(
                    application_table,
                    program_table.c.name.label("programName"),
                    university_table.c.name.label("universityName"),
                )
                .join(program_table, program_table.c.id == application_table.c.programId)
                .join(
                    university_table,
                    university_table.c.id == program_table.c.universityId,
                )
                .where(application_table.c.studentId == student_id)
            )
        ).mappings()
    ]
    documents = [
        dict(row)
        for row in (
            await db.execute(
                select(document_table).where(document_table.c.studentId == student_id)
            )
        ).mappings()
    ]
    tasks = [
        dict(row)
        for row in (
            await db.execute(select(task_table).where(task_table.c.studentId == student_id))
        ).mappings()
    ]
    deadlines = [
        dict(row)
        for row in (
            await db.execute(
                select(deadline_table).where(deadline_table.c.studentId == student_id)
            )
        ).mappings()
    ]

    requirements_by_application: dict[str, list[dict[str, Any]]] = {}
    if applications:
        rows = (
            await db.execute(
                select(requirement_table).where(
                    requirement_table.c.applicationId.in_(
                        [application["id"] for application in applications]
                    )
                )
            )
        ).mappings()
        for row in rows:
            requirements_by_application.setdefault(row.applicationId, []).append(dict(row))

    waiting_days_max = max(
        (
            _days_waiting(document["requestedAt"], now)
            for document in documents
            if document["status"] in {"REQUESTED", "NEEDS_CHANGES"}
        ),
        default=0,
    )
    has_overdue_urgent = any(
        task["status"] != "DONE"
        and task["priority"] == "URGENT"
        and _utc(task["dueDate"]) is not None
        and _utc(task["dueDate"]) < now
        for task in tasks
    )

    application_risks: list[str] = []
    documents_by_id = {document["id"]: document for document in documents}
    for application in applications:
        requirements = requirements_by_application.get(application["id"], [])
        pairs = [(item["status"], item["isCritical"]) for item in requirements]
        linked_waiting_days = max(
            (
                _days_waiting(document["requestedAt"], now)
                for item in requirements
                if item.get("relatedDocumentId")
                and (document := documents_by_id.get(item["relatedDocumentId"]))
                and document["status"] in {"REQUESTED", "NEEDS_CHANGES"}
            ),
            default=0,
        )
        readiness = calculate_readiness(status for status, _ in pairs)
        risk = calculate_application_risk(
            application["status"],
            pairs,
            application["hardDeadline"],
            linked_waiting_days,
            has_overdue_urgent,
            now,
        )
        application_risks.append(risk)
        critical_done = all(
            status in {"COMPLETED", "NOT_APPLICABLE"}
            for status, critical in pairs
            if critical
        )
        next_status = application["status"]
        if (
            critical_done
            and readiness >= 90
            and application["status"] in {"SELECTED", "PREPARING"}
        ):
            next_status = "READY_FOR_REVIEW"
        await db.execute(
            update(application_table)
            .where(application_table.c.id == application["id"])
            .values(
                readinessPercent=readiness,
                riskLevel=risk,
                status=next_status,
                updatedAt=now,
            )
        )

    risk_level = calculate_student_risk_from_signals(
        application_risks, waiting_days_max, has_overdue_urgent
    )
    next_action = compute_next_action(
        student_id,
        applications,
        requirements_by_application,
        documents,
        tasks,
        deadlines,
        now,
    )
    await db.execute(
        update(student_table)
        .where(student_table.c.id == student_id)
        .values(riskLevel=risk_level, nextActionJson=json.dumps(next_action, ensure_ascii=False))
    )
    return {"risk_level": risk_level, "next_action": next_action}
