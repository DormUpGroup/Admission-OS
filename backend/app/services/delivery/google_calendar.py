import json
from datetime import UTC, datetime, timedelta
from typing import Any
from urllib.parse import quote

import httpx
import jwt
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.db.tables import appointment_table

CALENDAR_SCOPE = "https://www.googleapis.com/auth/calendar.events"


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


async def create_google_calendar_event(
    db: AsyncSession, event: dict[str, Any]
) -> None:
    appointment_id = str(event["payloadJson"].get("appointment_id") or "")
    appointment = (
        await db.execute(
            select(appointment_table).where(appointment_table.c.id == appointment_id)
        )
    ).mappings().first()
    if appointment is None:
        raise ValueError("Appointment not found")
    if appointment.googleEventId:
        return
    settings = get_settings()
    if not settings.google_calendar_id or not settings.google_service_account_json:
        raise RuntimeError("Google Calendar is not configured")
    credentials = json.loads(settings.google_service_account_json)
    token = await _access_token(credentials)
    participants = appointment.participantsJson or []
    attendees = [
        {"email": item["email"]}
        for item in participants
        if isinstance(item, dict) and item.get("email")
    ]
    url = (
        "https://www.googleapis.com/calendar/v3/calendars/"
        f"{quote(settings.google_calendar_id, safe='')}/events"
    )
    async with httpx.AsyncClient(timeout=20.0) as client:
        existing_event_id = await find_google_event_by_appointment(
            client,
            token=token,
            calendar_id=settings.google_calendar_id,
            appointment_id=appointment_id,
        )
        if existing_event_id:
            now = datetime.now(UTC)
            await db.execute(
                update(appointment_table)
                .where(appointment_table.c.id == appointment_id)
                .values(
                    googleEventId=existing_event_id,
                    status="CONFIRMED",
                    updatedAt=now,
                )
            )
            return
        try:
            response = await client.post(
                url,
                headers={"Authorization": f"Bearer {token}"},
                params={"sendUpdates": "all" if attendees else "none"},
                json={
                    "summary": appointment.title,
                    "start": {
                        "dateTime": appointment.startsAt.isoformat(),
                        "timeZone": appointment.timezone,
                    },
                    "end": {
                        "dateTime": appointment.endsAt.isoformat(),
                        "timeZone": appointment.timezone,
                    },
                    "attendees": attendees,
                    "extendedProperties": {
                        "private": {"immigromeAppointmentId": appointment_id}
                    },
                },
            )
        except (httpx.TimeoutException, httpx.NetworkError):
            recovered = await find_google_event_by_appointment(
                client,
                token=token,
                calendar_id=settings.google_calendar_id,
                appointment_id=appointment_id,
            )
            if recovered:
                now = datetime.now(UTC)
                await db.execute(
                    update(appointment_table)
                    .where(appointment_table.c.id == appointment_id)
                    .values(
                        googleEventId=recovered,
                        status="CONFIRMED",
                        updatedAt=now,
                    )
                )
                return
            raise
    response.raise_for_status()
    google_event_id = response.json().get("id")
    if not google_event_id:
        raise RuntimeError("Google Calendar did not return an event id")
    now = datetime.now(UTC)
    await db.execute(
        update(appointment_table)
        .where(appointment_table.c.id == appointment_id)
        .values(
            googleEventId=str(google_event_id),
            status="CONFIRMED",
            updatedAt=now,
        )
    )
