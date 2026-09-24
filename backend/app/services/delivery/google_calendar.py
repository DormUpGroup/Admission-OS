"""Google Calendar appointment sync with prepare / call / finalize.

**Idempotent recovery:** create uses a deterministic Calendar event ``id`` derived
from the appointment id (charset ``[a-v0-9]{5,1024}``). On HTTP 409 conflict,
GET that event and attach. Secondary recovery searches private extended
property ``immigromeAppointmentId``. Timeouts after create may leave an event
that reclaim reattaches without creating a duplicate.

Unlike Telegram (at-most-once automatic delivery), Calendar may safely retry
the external call because provider-side identity is deterministic.
"""

from __future__ import annotations

import hashlib
import json
import re
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Any, Literal
from urllib.parse import quote

import httpx
import jwt
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.db.tables import appointment_table

CALENDAR_SCOPE = "https://www.googleapis.com/auth/calendar.events"
_GOOGLE_EVENT_ID_RE = re.compile(r"^[a-v0-9]{5,1024}$")


def deterministic_google_event_id(appointment_id: str) -> str:
    """Map appointment id → Google-allowed client-supplied event id."""
    digest = hashlib.sha256(
        f"immigrome-appointment:{appointment_id}".encode()
    ).hexdigest()
    # hexdigest is [0-9a-f], a subset of [a-v0-9], length 64.
    if not _GOOGLE_EVENT_ID_RE.match(digest):
        raise RuntimeError("deterministic Google event id failed charset check")
    return digest


@dataclass(frozen=True)
class PreparedCalendarCreate:
    action: Literal["create", "skip"]
    appointment_id: str
    title: str | None
    starts_at: datetime | None
    ends_at: datetime | None
    timezone: str | None
    attendees: tuple[dict[str, str], ...]
    calendar_id: str | None
    credentials_json: str | None
    provider_event_id: str | None


@dataclass(frozen=True)
class CalendarCallResult:
    google_event_id: str


async def _access_token(credentials: dict[str, Any]) -> str:
    now = datetime.now(UTC)
    token_uri = str(credentials.get("token_uri") or "https://oauth2.googleapis.com/token")
    assertion = jwt.encode(
        {
            "iss": credentials["client_email"],
            "scope": CALENDAR_SCOPE,
            "aud": token_uri,
            "iat": int(now.timestamp()),
            "exp": int((now + timedelta(minutes=55)).timestamp()),
        },
        credentials["private_key"],
        algorithm="RS256",
    )
    async with httpx.AsyncClient(timeout=20.0) as client:
        response = await client.post(
            token_uri,
            data={
                "grant_type": "urn:ietf:params:oauth:grant-type:jwt-bearer",
                "assertion": assertion,
            },
        )
    response.raise_for_status()
    token = response.json().get("access_token")
    if not token:
        raise RuntimeError("Google OAuth did not return an access token")
    return str(token)


async def find_google_event_by_appointment(
    client: httpx.AsyncClient,
    *,
    token: str,
    calendar_id: str,
    appointment_id: str,
) -> str | None:
    url = (
        "https://www.googleapis.com/calendar/v3/calendars/"
        f"{quote(calendar_id, safe='')}/events"
    )
    response = await client.get(
        url,
        headers={"Authorization": f"Bearer {token}"},
        params={
            "privateExtendedProperty": f"immigromeAppointmentId={appointment_id}",
            "maxResults": 1,
            "singleEvents": "true",
        },
    )
    response.raise_for_status()
    items = response.json().get("items")
    if not isinstance(items, list) or not items:
        return None
    event_id = items[0].get("id") if isinstance(items[0], dict) else None
    return str(event_id) if event_id else None


async def get_google_event_by_id(
    client: httpx.AsyncClient,
    *,
    token: str,
    calendar_id: str,
    event_id: str,
) -> str | None:
    url = (
        "https://www.googleapis.com/calendar/v3/calendars/"
        f"{quote(calendar_id, safe='')}/events/{quote(event_id, safe='')}"
    )
    response = await client.get(
        url,
        headers={"Authorization": f"Bearer {token}"},
    )
    if response.status_code == 404:
        return None
    response.raise_for_status()
    payload = response.json()
    found = payload.get("id")
    return str(found) if found else None


async def prepare_google_calendar_event(
    db: AsyncSession, event: dict[str, Any]
) -> PreparedCalendarCreate:
    """Load appointment; skip if already synced. No HTTP."""
    appointment_id = str(event["payloadJson"].get("appointment_id") or "")
    appointment = (
        await db.execute(
            select(appointment_table).where(appointment_table.c.id == appointment_id)
        )
    ).mappings().first()
    if appointment is None:
        raise ValueError("Appointment not found")
    if appointment.googleEventId:
        return PreparedCalendarCreate(
            action="skip",
            appointment_id=appointment_id,
            title=None,
            starts_at=None,
            ends_at=None,
            timezone=None,
            attendees=(),
            calendar_id=None,
            credentials_json=None,
            provider_event_id=None,
        )
    settings = get_settings()
    if not settings.google_calendar_id or not settings.google_service_account_json:
        raise RuntimeError("Google Calendar is not configured")
    participants = appointment.participantsJson or []
    attendees = tuple(
        {"email": str(item["email"])}
        for item in participants
        if isinstance(item, dict) and item.get("email")
    )
    return PreparedCalendarCreate(
        action="create",
        appointment_id=appointment_id,
        title=appointment.title,
        starts_at=appointment.startsAt,
        ends_at=appointment.endsAt,
        timezone=appointment.timezone,
        attendees=attendees,
        calendar_id=settings.google_calendar_id,
        credentials_json=settings.google_service_account_json,
        provider_event_id=deterministic_google_event_id(appointment_id),
    )


async def call_google_calendar_event(
    prepared: PreparedCalendarCreate,
) -> CalendarCallResult:
    """OAuth + Calendar HTTP outside any DB transaction."""
    if prepared.action != "create":
        raise RuntimeError("call_google_calendar_event requires action=create")
    assert (
        prepared.calendar_id
        and prepared.credentials_json
        and prepared.provider_event_id
        and prepared.title
        and prepared.starts_at
        and prepared.ends_at
        and prepared.timezone
    )
    credentials = json.loads(prepared.credentials_json)
    token = await _access_token(credentials)
    calendar_id = prepared.calendar_id
    provider_event_id = prepared.provider_event_id
    url = (
        "https://www.googleapis.com/calendar/v3/calendars/"
        f"{quote(calendar_id, safe='')}/events"
    )
    attendees = list(prepared.attendees)
    async with httpx.AsyncClient(timeout=20.0) as client:
        # Primary: create with deterministic id.
        try:
            response = await client.post(
                url,
                headers={"Authorization": f"Bearer {token}"},
                params={"sendUpdates": "all" if attendees else "none"},
                json={
                    "id": provider_event_id,
                    "summary": prepared.title,
                    "start": {
                        "dateTime": prepared.starts_at.isoformat(),
                        "timeZone": prepared.timezone,
                    },
                    "end": {
                        "dateTime": prepared.ends_at.isoformat(),
                        "timeZone": prepared.timezone,
                    },
                    "attendees": attendees,
                    "extendedProperties": {
                        "private": {
                            "immigromeAppointmentId": prepared.appointment_id
                        }
                    },
                },
            )
        except (httpx.TimeoutException, httpx.NetworkError):
            recovered = await get_google_event_by_id(
                client,
                token=token,
                calendar_id=calendar_id,
                event_id=provider_event_id,
            )
            if recovered:
                return CalendarCallResult(google_event_id=recovered)
            secondary = await find_google_event_by_appointment(
                client,
                token=token,
                calendar_id=calendar_id,
                appointment_id=prepared.appointment_id,
            )
            if secondary:
                return CalendarCallResult(google_event_id=secondary)
            raise

        if response.status_code == 409:
            recovered = await get_google_event_by_id(
                client,
                token=token,
                calendar_id=calendar_id,
                event_id=provider_event_id,
            )
            if recovered:
                return CalendarCallResult(google_event_id=recovered)
            secondary = await find_google_event_by_appointment(
                client,
                token=token,
                calendar_id=calendar_id,
                appointment_id=prepared.appointment_id,
            )
            if secondary:
                return CalendarCallResult(google_event_id=secondary)
            response.raise_for_status()

        response.raise_for_status()
        google_event_id = response.json().get("id")
        if not google_event_id:
            raise RuntimeError("Google Calendar did not return an event id")
        return CalendarCallResult(google_event_id=str(google_event_id))


async def finalize_google_calendar_event(
    db: AsyncSession,
    prepared: PreparedCalendarCreate,
    *,
    result: CalendarCallResult | None = None,
) -> None:
    """Persist googleEventId after a successful call. No HTTP."""
    if prepared.action == "skip":
        return
    if result is None:
        raise RuntimeError("finalize_google_calendar_event requires result")
    now = datetime.now(UTC)
    await db.execute(
        update(appointment_table)
        .where(appointment_table.c.id == prepared.appointment_id)
        .values(
            googleEventId=result.google_event_id,
            status="CONFIRMED",
            updatedAt=now,
        )
    )


async def create_google_calendar_event(
    db: AsyncSession, event: dict[str, Any]
) -> None:
    """Compatibility helper; prefer prepare → call → finalize in the worker."""
    prepared = await prepare_google_calendar_event(db, event)
    if prepared.action == "skip":
        return
    await db.flush()
    result = await call_google_calendar_event(prepared)
    await finalize_google_calendar_event(db, prepared, result=result)
