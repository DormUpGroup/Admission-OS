"""Pure accompaniment / intake seat helpers mirrored from TypeScript rules."""

from __future__ import annotations

import re


def normalize_intake_key(intake: str | None) -> str:
    raw = (intake or "").strip()
    if not raw:
        return ""
    years = re.findall(r"20\d{2}", raw)
    if len(years) >= 2:
        return f"{years[0]}/{years[1][-2:]}"
    if len(years) == 1:
        start = int(years[0])
        return f"{start}/{str(start + 1)[-2:]}"
    return re.sub(r"\s+", "", raw)


def intake_aliases(intake: str | None) -> list[str]:
    key = normalize_intake_key(intake)
    if not key:
        return []
    start = key[:4]
    end2 = key[-2:]
    end_full = f"{start[:2]}{end2}"
    candidates = [key, f"{start}/{end_full}", (intake or "").strip()]
    return list(dict.fromkeys(item for item in candidates if item))


def occupies_seat(status: str | None) -> bool:
    return status == "ACCEPTED"


def can_accept_to_cohort(
    occupied: int, limit: int | None
) -> tuple[bool, str | None]:
    if limit is None:
        return True, None
    if occupied >= limit:
        return False, "Мест в наборе нет"
    return True, None
