import { createHash, createSign, randomUUID } from "crypto";
import type { Appointment, OutboxEvent } from "@prisma/client";
import { prisma } from "@/lib/db";

const CALENDAR_SCOPE = "https://www.googleapis.com/auth/calendar.events";
const GOOGLE_EVENT_ID_RE = /^[a-v0-9]{5,1024}$/;

export type ServiceAccountCredentials = {
  client_email: string;
  private_key: string;
  token_uri?: string;
};

export type PreparedCalendarUpsert = {
  action: "create" | "patch" | "skip";
  appointment: Appointment;
  providerEventId: string;
  calendarId: string;
  credentials: ServiceAccountCredentials;
};

export type PreparedCalendarDelete = {
  action: "delete" | "skip";
  appointmentId: string;
  googleEventId: string | null;
  calendarId: string | null;
  credentials: ServiceAccountCredentials | null;
};

export function deterministicGoogleEventId(appointmentId: string): string {
  const digest = createHash("sha256")
    .update(`immigrome-appointment:${appointmentId}`)
    .digest("hex");
  if (!GOOGLE_EVENT_ID_RE.test(digest)) {
    throw new Error("deterministic Google event id failed charset check");
  }
  return digest;
}

export function parseServiceAccountJson(
  raw: string | undefined,
): ServiceAccountCredentials {
  if (!raw?.trim()) {
    throw new Error("GOOGLE_SERVICE_ACCOUNT_JSON is not configured");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("GOOGLE_SERVICE_ACCOUNT_JSON is not valid JSON");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("GOOGLE_SERVICE_ACCOUNT_JSON must be an object");
  }
  const obj = parsed as Record<string, unknown>;
  const clientEmail = obj.client_email;
  const privateKey = obj.private_key;
  if (typeof clientEmail !== "string" || typeof privateKey !== "string") {
    throw new Error(
      "GOOGLE_SERVICE_ACCOUNT_JSON requires client_email and private_key",
    );
  }
  return {
    client_email: clientEmail,
    private_key: privateKey.replace(/\\n/g, "\n"),
    token_uri:
      typeof obj.token_uri === "string"
        ? obj.token_uri
        : "https://oauth2.googleapis.com/token",
  };
}

function base64url(input: Buffer | string): string {
  const buf = typeof input === "string" ? Buffer.from(input) : input;
  return buf
    .toString("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

export async function getGoogleAccessToken(
  credentials: ServiceAccountCredentials,
  fetchImpl: typeof fetch = fetch,
): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const tokenUri =
    credentials.token_uri ?? "https://oauth2.googleapis.com/token";
  const header = base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claim = base64url(
    JSON.stringify({
      iss: credentials.client_email,
      scope: CALENDAR_SCOPE,
      aud: tokenUri,
      iat: now,
      exp: now + 55 * 60,
    }),
  );
  const unsigned = `${header}.${claim}`;
  const signer = createSign("RSA-SHA256");
  signer.update(unsigned);
  signer.end();
  const signature = base64url(signer.sign(credentials.private_key));
  const assertion = `${unsigned}.${signature}`;

  const response = await fetchImpl(tokenUri, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }),
  });
  const data = (await response.json().catch(() => null)) as {
    access_token?: string;
    error?: string;
  } | null;
  if (!response.ok || !data?.access_token) {
    throw new Error(
      data?.error ?? `Google OAuth token exchange failed (${response.status})`,
    );
  }
  return data.access_token;
}

function calendarEventsUrl(calendarId: string, eventId?: string): string {
  const base = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`;
  return eventId ? `${base}/${encodeURIComponent(eventId)}` : base;
}

function eventBody(appointment: Appointment, providerEventId: string) {
  return {
    id: providerEventId,
    summary: appointment.title,
    start: {
      dateTime: appointment.startsAt.toISOString(),
      timeZone: appointment.timezone,
    },
    end: {
      dateTime: appointment.endsAt.toISOString(),
      timeZone: appointment.timezone,
    },
    extendedProperties: {
      private: {
        immigromeAppointmentId: appointment.id,
      },
    },
  };
}

export async function prepareCalendarUpsert(
  event: OutboxEvent,
  env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env,
): Promise<PreparedCalendarUpsert> {
  const payload = event.payloadJson;
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new Error("calendar.upsert payload must be an object");
  }
  const appointmentId = String(
    (payload as { appointmentId?: unknown }).appointmentId ?? "",
  );
  if (!appointmentId) {
    throw new Error("calendar.upsert requires appointmentId");
  }

  const appointment = await prisma.appointment.findUnique({
    where: { id: appointmentId },
  });
  if (!appointment) {
    throw new Error(`Appointment ${appointmentId} not found`);
  }
  if (appointment.status === "CANCELLED") {
    throw new Error("Cannot upsert a cancelled appointment");
  }

  const calendarId = env.GOOGLE_CALENDAR_ID?.trim();
  if (!calendarId) {
    throw new Error("GOOGLE_CALENDAR_ID is not configured");
  }
  const credentials = parseServiceAccountJson(env.GOOGLE_SERVICE_ACCOUNT_JSON);
  const providerEventId =
    appointment.googleEventId ?? deterministicGoogleEventId(appointment.id);

  if (
    appointment.googleEventId &&
    appointment.status === "CONFIRMED" &&
    appointment.googleEventId === providerEventId
  ) {
    // Still patch on reschedule (PENDING after reschedule). Skip only if already confirmed
    // and outbox is a pure duplicate with matching version semantics handled by idempotency key.
  }

  const action: PreparedCalendarUpsert["action"] = appointment.googleEventId
    ? "patch"
    : "create";

  return {
    action,
    appointment,
    providerEventId,
    calendarId,
    credentials,
  };
}

export async function callCalendarUpsert(
  prepared: PreparedCalendarUpsert,
  fetchImpl: typeof fetch = fetch,
): Promise<{ googleEventId: string }> {
  const token = await getGoogleAccessToken(prepared.credentials, fetchImpl);
  const body = eventBody(prepared.appointment, prepared.providerEventId);

  if (prepared.action === "patch" && prepared.appointment.googleEventId) {
    const response = await fetchImpl(
      calendarEventsUrl(prepared.calendarId, prepared.appointment.googleEventId),
      {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          summary: body.summary,
          start: body.start,
          end: body.end,
          extendedProperties: body.extendedProperties,
        }),
      },
    );
    if (response.ok) {
      const data = (await response.json()) as { id?: string };
      return { googleEventId: String(data.id ?? prepared.appointment.googleEventId) };
    }
    if (response.status !== 404) {
      throw new Error(`Google Calendar PATCH failed (${response.status})`);
    }
    // Fall through to create if patch target missing.
  }

  const insertResponse = await fetchImpl(calendarEventsUrl(prepared.calendarId), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (insertResponse.status === 409) {
    const getResponse = await fetchImpl(
      calendarEventsUrl(prepared.calendarId, prepared.providerEventId),
      {
        headers: { Authorization: `Bearer ${token}` },
      },
    );
    if (getResponse.ok) {
      const data = (await getResponse.json()) as { id?: string };
      if (data.id) return { googleEventId: String(data.id) };
    }

    const search = new URL(calendarEventsUrl(prepared.calendarId));
    search.searchParams.set(
      "privateExtendedProperty",
      `immigromeAppointmentId=${prepared.appointment.id}`,
    );
    search.searchParams.set("maxResults", "1");
    search.searchParams.set("singleEvents", "true");
    const searchResponse = await fetchImpl(search.toString(), {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (searchResponse.ok) {
      const data = (await searchResponse.json()) as {
        items?: Array<{ id?: string }>;
      };
      const found = data.items?.[0]?.id;
      if (found) return { googleEventId: String(found) };
    }
    throw new Error("Google Calendar 409 conflict and recovery failed");
  }

  if (!insertResponse.ok) {
    throw new Error(`Google Calendar INSERT failed (${insertResponse.status})`);
  }
  const data = (await insertResponse.json()) as { id?: string };
  if (!data.id) {
    throw new Error("Google Calendar INSERT returned no event id");
  }
  return { googleEventId: String(data.id) };
}

export async function finalizeCalendarUpsert(
  appointmentId: string,
  googleEventId: string,
): Promise<Appointment> {
  // Client already confirmed via Telegram/admin; calendar sync marks CONFIRMED.
  return prisma.appointment.update({
    where: { id: appointmentId },
    data: {
      googleEventId,
      status: "CONFIRMED",
    },
  });
}

export async function prepareCalendarDelete(
  event: OutboxEvent,
  env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env,
): Promise<PreparedCalendarDelete> {
  const payload = event.payloadJson;
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new Error("calendar.delete payload must be an object");
  }
  const appointmentId = String(
    (payload as { appointmentId?: unknown }).appointmentId ?? "",
  );
  if (!appointmentId) {
    throw new Error("calendar.delete requires appointmentId");
  }

  const appointment = await prisma.appointment.findUnique({
    where: { id: appointmentId },
  });
  if (!appointment) {
    return {
      action: "skip",
      appointmentId,
      googleEventId: null,
      calendarId: null,
      credentials: null,
    };
  }

  const googleEventId =
    appointment.googleEventId ??
    (typeof (payload as { googleEventId?: unknown }).googleEventId === "string"
      ? String((payload as { googleEventId?: unknown }).googleEventId)
      : null);

  if (!googleEventId) {
    return {
      action: "skip",
      appointmentId,
      googleEventId: null,
      calendarId: null,
      credentials: null,
    };
  }

  const calendarId = env.GOOGLE_CALENDAR_ID?.trim() ?? null;
  if (!calendarId) {
    throw new Error("GOOGLE_CALENDAR_ID is not configured");
  }
  const credentials = parseServiceAccountJson(env.GOOGLE_SERVICE_ACCOUNT_JSON);

  return {
    action: "delete",
    appointmentId,
    googleEventId,
    calendarId,
    credentials,
  };
}

export async function callCalendarDelete(
  prepared: PreparedCalendarDelete,
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  if (
    prepared.action !== "delete" ||
    !prepared.googleEventId ||
    !prepared.calendarId ||
    !prepared.credentials
  ) {
    return;
  }
  const token = await getGoogleAccessToken(prepared.credentials, fetchImpl);
  const response = await fetchImpl(
    calendarEventsUrl(prepared.calendarId, prepared.googleEventId),
    {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
    },
  );
  if (!response.ok && response.status !== 404 && response.status !== 410) {
    throw new Error(`Google Calendar DELETE failed (${response.status})`);
  }
}

export async function finalizeCalendarDelete(
  appointmentId: string,
): Promise<void> {
  await prisma.appointment.updateMany({
    where: { id: appointmentId },
    data: {
      googleEventId: null,
      status: "CANCELLED",
    },
  });
}

/** Test helper: unique client request id. */
export function newAppointmentClientRequestId(): string {
  return `appt:${randomUUID()}`;
}
