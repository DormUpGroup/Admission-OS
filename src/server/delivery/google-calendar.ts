import { createHash, createSign, randomUUID } from "crypto";
import type { Appointment, OutboxEvent } from "@prisma/client";
import { prisma } from "@/lib/db";

const CALENDAR_SCOPE = "https://www.googleapis.com/auth/calendar.events";
const GOOGLE_EVENT_ID_RE = /^[a-v0-9]{5,1024}$/;

export type ServiceAccountCredentials = {
  client_email: string;
  private_key: string;
  token_uri?: string;
  /** Workspace user to impersonate. Required for Google Meet. */
  subject?: string;
};

export type PreparedCalendarUpsert = {
  action: "create" | "patch" | "skip";
  appointment: Appointment | null;
  providerEventId: string;
  calendarId: string;
  credentials: ServiceAccountCredentials;
  curatorEmail?: string | null;
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
    private_key: normalizePemPrivateKey(privateKey),
    token_uri:
      typeof obj.token_uri === "string"
        ? obj.token_uri
        : "https://oauth2.googleapis.com/token",
  };
}

export function calendarCredentials(
  env: NodeJS.ProcessEnv | Record<string, string | undefined>,
): ServiceAccountCredentials {
  const subject = env.GOOGLE_CALENDAR_SUBJECT?.trim().replace(/\r/g, "");
  if (!subject) {
    throw new Error("GOOGLE_CALENDAR_SUBJECT is not configured");
  }
  return { ...parseServiceAccountJson(env.GOOGLE_SERVICE_ACCOUNT_JSON), subject };
}

/** Accept escaped \\n, real newlines, or a compacted one-line PEM. */
export function normalizePemPrivateKey(raw: string): string {
  const key = raw.replace(/\\n/g, "\n").trim();
  if (key.includes("\n")) return key.endsWith("\n") ? key : `${key}\n`;
  const begin = "-----BEGIN PRIVATE KEY-----";
  const end = "-----END PRIVATE KEY-----";
  if (!key.startsWith(begin) || !key.endsWith(end)) {
    return key;
  }
  const body = key.slice(begin.length, key.length - end.length).replace(/\s+/g, "");
  const lines = body.match(/.{1,64}/g) ?? [];
  return `${begin}\n${lines.join("\n")}\n${end}\n`;
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
      ...(credentials.subject ? { sub: credentials.subject } : {}),
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

function calendarEventsUrl(
  calendarId: string,
  eventId?: string,
  options?: { conference?: boolean; sendUpdates?: boolean },
): string {
  const base = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`;
  const url = new URL(eventId ? `${base}/${encodeURIComponent(eventId)}` : base);
  if (options?.conference) url.searchParams.set("conferenceDataVersion", "1");
  if (options?.sendUpdates) url.searchParams.set("sendUpdates", "all");
  return url.toString();
}

export type CalendarConferenceEvent = {
  hangoutLink?: string;
  conferenceData?: {
    entryPoints?: Array<{ entryPointType?: string; uri?: string }>;
  };
};

export function meetingUrlFromCalendarEvent(
  data: CalendarConferenceEvent | null | undefined,
): string | null {
  const hangout = data?.hangoutLink?.trim();
  if (hangout) return hangout;
  const video = data?.conferenceData?.entryPoints?.find(
    (point) => point.entryPointType === "video" && point.uri?.trim(),
  );
  return video?.uri?.trim() || null;
}

export function buildCalendarEventBody(
  appointment: Appointment,
  providerEventId: string,
  curatorEmail?: string | null,
) {
  const summary = appointment.guestName?.trim()
    ? `${appointment.title}: ${appointment.guestName.trim()}`
    : appointment.title;
  const body: Record<string, unknown> = {
    id: providerEventId,
    summary,
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
  const attendees = [appointment.guestEmail?.trim(), curatorEmail?.trim()]
    .filter((email): email is string => Boolean(email))
    .filter((email, index, all) => all.indexOf(email) === index)
    .map((email) => ({ email }));
  if (attendees.length > 0) {
    body.attendees = attendees;
    const who = [appointment.guestName?.trim(), appointment.guestEmail?.trim(), curatorEmail?.trim()]
      .filter(Boolean)
      .join("\n");
    body.description = who;
  }
  if (!appointment.meetingUrl) {
    body.conferenceData = {
      createRequest: {
        requestId: appointment.id,
        conferenceSolutionKey: { type: "hangoutsMeet" },
      },
    };
  }
  return body;
}

function requireMeetingUrl(
  data: CalendarConferenceEvent & { id?: string },
  fallback: string | null,
): { googleEventId: string; meetingUrl: string } {
  if (!data.id) throw new Error("Google Calendar returned no event id");
  const meetingUrl = meetingUrlFromCalendarEvent(data) ?? fallback;
  if (!meetingUrl) throw new Error("Google Calendar event has no Meet link");
  return { googleEventId: String(data.id), meetingUrl };
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
    return {
      action: "skip",
      appointment: null,
      providerEventId: "",
      calendarId: "",
      credentials: { client_email: "", private_key: "" },
    };
  }
  if (appointment.status === "CANCELLED") {
    return {
      action: "skip",
      appointment,
      providerEventId: appointment.googleEventId ?? "",
      calendarId: "",
      credentials: {
        client_email: "",
        private_key: "",
      },
    };
  }

  const calendarId = env.GOOGLE_CALENDAR_ID?.trim().replace(/\r/g, "");
  if (!calendarId) {
    throw new Error("GOOGLE_CALENDAR_ID is not configured");
  }
  const credentials = calendarCredentials(env);
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

  let curatorEmail: string | null = null;
  if (appointment.assignedCuratorId) {
    const curator = await prisma.user.findUnique({
      where: { id: appointment.assignedCuratorId },
      select: { email: true },
    });
    curatorEmail = curator?.email?.trim() || null;
  }

  return {
    action,
    appointment,
    providerEventId,
    calendarId,
    credentials,
    curatorEmail,
  };
}

export async function callCalendarUpsert(
  prepared: PreparedCalendarUpsert,
  fetchImpl: typeof fetch = fetch,
): Promise<{ googleEventId: string; meetingUrl: string }> {
  if (prepared.action === "skip" || !prepared.appointment) {
    throw new Error("callCalendarUpsert requires an appointment");
  }
  const token = await getGoogleAccessToken(prepared.credentials, fetchImpl);
  const body = buildCalendarEventBody(
    prepared.appointment,
    prepared.providerEventId,
    prepared.curatorEmail,
  );
  const sendUpdates = Boolean(
    prepared.appointment.guestEmail?.trim() || prepared.curatorEmail?.trim(),
  );
  const writeUrl = (eventId?: string) =>
    calendarEventsUrl(prepared.calendarId, eventId, {
      conference: true,
      sendUpdates,
    });
  const fallbackMeetingUrl = prepared.appointment.meetingUrl;

  if (prepared.action === "patch" && prepared.appointment.googleEventId) {
    const response = await fetchImpl(
      writeUrl(prepared.appointment.googleEventId),
      {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ ...body, id: undefined }),
      },
    );
    if (response.ok) {
      const data = (await response.json()) as CalendarConferenceEvent & { id?: string };
      return requireMeetingUrl(
        { ...data, id: data.id ?? prepared.appointment.googleEventId },
        fallbackMeetingUrl,
      );
    }
    if (response.status !== 404 && response.status !== 410) {
      throw new Error(`Google Calendar PATCH failed (${response.status})`);
    }
    // Fall through to create if patch target missing / gone.
  }

  const insertWithId = await fetchImpl(writeUrl(), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (insertWithId.status === 409) {
    const getResponse = await fetchImpl(
      calendarEventsUrl(prepared.calendarId, prepared.providerEventId, {
        conference: true,
      }),
      {
        headers: { Authorization: `Bearer ${token}` },
      },
    );
    if (getResponse.ok) {
      const data = (await getResponse.json()) as CalendarConferenceEvent & { id?: string };
      if (data.id) return requireMeetingUrl(data, fallbackMeetingUrl);
    }

    const search = new URL(calendarEventsUrl(prepared.calendarId));
    search.searchParams.set("conferenceDataVersion", "1");
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
        items?: Array<CalendarConferenceEvent & { id?: string }>;
      };
      const found = data.items?.[0];
      if (found?.id) return requireMeetingUrl(found, fallbackMeetingUrl);
    }
    throw new Error("Google Calendar 409 conflict and recovery failed");
  }

  if (insertWithId.ok) {
    const data = (await insertWithId.json()) as CalendarConferenceEvent & { id?: string };
    return requireMeetingUrl(data, fallbackMeetingUrl);
  }

  // Deleted deterministic ids return 404/410 and cannot be reused — insert without id.
  if (insertWithId.status === 404 || insertWithId.status === 410) {
    const retry = await fetchImpl(writeUrl(), {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ ...body, id: undefined }),
    });
    if (!retry.ok) {
      throw new Error(
        `Google Calendar INSERT failed (${insertWithId.status}, retry ${retry.status})`,
      );
    }
    const data = (await retry.json()) as CalendarConferenceEvent & { id?: string };
    return requireMeetingUrl(data, fallbackMeetingUrl);
  }

  throw new Error(`Google Calendar INSERT failed (${insertWithId.status})`);
}

export async function finalizeCalendarUpsert(
  appointmentId: string,
  googleEventId: string,
  meetingUrl?: string | null,
): Promise<Appointment | null> {
  // Client already confirmed via Telegram/admin; calendar sync marks CONFIRMED.
  // updateMany does not throw when the row was deleted after the Google call.
  const updated = await prisma.appointment.updateMany({
    where: { id: appointmentId },
    data: {
      googleEventId,
      status: "CONFIRMED",
      ...(meetingUrl ? { meetingUrl } : {}),
    },
  });
  if (updated.count === 0) return null;
  return prisma.appointment.findUnique({ where: { id: appointmentId } });
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
  const payloadEventId =
    typeof (payload as { googleEventId?: unknown }).googleEventId === "string"
      ? String((payload as { googleEventId?: unknown }).googleEventId)
      : null;
  if (!appointment) {
    if (!payloadEventId) {
      return {
        action: "skip",
        appointmentId,
        googleEventId: null,
        calendarId: null,
        credentials: null,
      };
    }
    const calendarId = env.GOOGLE_CALENDAR_ID?.trim().replace(/\r/g, "") ?? null;
    if (!calendarId) {
      throw new Error("GOOGLE_CALENDAR_ID is not configured");
    }
    return {
      action: "delete",
      appointmentId,
      googleEventId: payloadEventId,
      calendarId,
      credentials: calendarCredentials(env),
    };
  }

  const googleEventId = appointment.googleEventId ?? payloadEventId;

  if (!googleEventId) {
    return {
      action: "skip",
      appointmentId,
      googleEventId: null,
      calendarId: null,
      credentials: null,
    };
  }

  const calendarId = env.GOOGLE_CALENDAR_ID?.trim().replace(/\r/g, "") ?? null;
  if (!calendarId) {
    throw new Error("GOOGLE_CALENDAR_ID is not configured");
  }
  const credentials = calendarCredentials(env);

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
