import { generateKeyPairSync, randomUUID } from "crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@prisma/client";
import {
  appointmentCancel,
  appointmentCreate,
} from "@/server/commands/appointments";
import {
  callCalendarUpsert,
  deterministicGoogleEventId,
  finalizeCalendarUpsert,
  parseServiceAccountJson,
} from "@/server/delivery/google-calendar";
import type { Appointment } from "@prisma/client";

describe("google calendar helpers (unit)", () => {
  it("deterministic event id is stable and google-charset safe", () => {
    const id = "appt_test_123";
    const a = deterministicGoogleEventId(id);
    const b = deterministicGoogleEventId(id);
    expect(a).toBe(b);
    expect(a).toMatch(/^[a-v0-9]{64}$/);
  });

  it("parseServiceAccountJson requires email and key", () => {
    expect(() => parseServiceAccountJson("{}")).toThrow(/client_email/);
    const parsed = parseServiceAccountJson(
      JSON.stringify({
        client_email: "bot@example.iam.gserviceaccount.com",
        private_key: "-----BEGIN PRIVATE KEY-----\nX\n-----END PRIVATE KEY-----\n",
      }),
    );
    expect(parsed.client_email).toContain("@");
  });

  it("callCalendarUpsert inserts and returns event id (mocked fetch)", async () => {
    const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const pem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();

    const appointment = {
      id: "appt1",
      clientRequestId: "c1",
      leadId: null,
      studentId: "s1",
      conversationId: null,
      assignedCuratorId: "u1",
      title: "Консультация",
      startsAt: new Date("2026-10-01T10:00:00.000Z"),
      endsAt: new Date("2026-10-01T11:00:00.000Z"),
      timezone: "Europe/Rome",
      status: "PENDING",
      googleEventId: null,
      participantsJson: null,
      version: 1,
      createdAt: new Date(),
      updatedAt: new Date(),
    } satisfies Appointment;

    const providerEventId = deterministicGoogleEventId(appointment.id);
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("oauth2.googleapis.com/token")) {
        return new Response(JSON.stringify({ access_token: "tok" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      if (url.includes("/calendar/v3/calendars/") && init?.method === "POST") {
        const body = JSON.parse(String(init.body));
        expect(body.id).toBe(providerEventId);
        expect(body.extendedProperties.private.immigromeAppointmentId).toBe(
          appointment.id,
        );
        return new Response(JSON.stringify({ id: providerEventId }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      return new Response("not found", { status: 404 });
    });

    const result = await callCalendarUpsert(
      {
        action: "create",
        appointment,
        providerEventId,
        calendarId: "primary",
        credentials: {
          client_email: "bot@example.iam.gserviceaccount.com",
          private_key: pem,
        },
      },
      fetchMock as unknown as typeof fetch,
    );

    expect(result.googleEventId).toBe(providerEventId);
    expect(fetchMock).toHaveBeenCalled();
  });
});

const hasDatabase = Boolean(process.env.DATABASE_URL?.trim());
const describeDb = hasDatabase ? describe : describe.skip;

describeDb("appointments commands (db)", () => {
  const prisma = new PrismaClient();
  const prefix = `cal-test-${randomUUID()}`;
  let leadId: string;
  let curatorId: string;

  beforeAll(async () => {
    await prisma.$queryRaw`SELECT 1 FROM "Appointment" LIMIT 1`;
    const curator = await prisma.user.findFirst({
      where: { role: { in: ["ADMIN", "CURATOR"] } },
      select: { id: true },
    });
    if (!curator) {
      throw new Error("Need an ADMIN/CURATOR user for appointment tests");
    }
    curatorId = curator.id;
    const lead = await prisma.lead.create({
      data: {
        firstName: "Cal",
        lastName: "Test",
        source: "TELEGRAM",
        status: "NEW",
      },
    });
    leadId = lead.id;
  });

  afterAll(async () => {
    await prisma.appointment.deleteMany({
      where: { clientRequestId: { startsWith: prefix } },
    });
    await prisma.outboxEvent.deleteMany({
      where: { idempotencyKey: { contains: prefix } },
    });
    if (leadId) {
      await prisma.lead.deleteMany({ where: { id: leadId } });
    }
    await prisma.$disconnect();
  });

  it("create is idempotent on clientRequestId", async () => {
    const clientRequestId = `${prefix}:create`;
    const startsAt = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000);
    const endsAt = new Date(startsAt.getTime() + 60 * 60 * 1000);

    const first = await appointmentCreate({
      clientRequestId,
      leadId,
      assignedCuratorId: curatorId,
      startsAt,
      endsAt,
      title: "Test consult",
    });
    expect(first.created).toBe(true);

    const second = await appointmentCreate({
      clientRequestId,
      leadId,
      assignedCuratorId: curatorId,
      startsAt,
      endsAt,
      title: "Other title",
    });
    expect(second.created).toBe(false);
    expect(second.appointment.id).toBe(first.appointment.id);

    const outbox = await prisma.outboxEvent.findMany({
      where: {
        aggregateId: first.appointment.id,
        eventType: "calendar.upsert",
      },
    });
    expect(outbox.length).toBe(1);
  });

  it("cancel enqueues calendar.delete", async () => {
    const clientRequestId = `${prefix}:cancel`;
    const startsAt = new Date(Date.now() + 4 * 24 * 60 * 60 * 1000);
    const endsAt = new Date(startsAt.getTime() + 60 * 60 * 1000);
    const { appointment } = await appointmentCreate({
      clientRequestId,
      leadId,
      assignedCuratorId: curatorId,
      startsAt,
      endsAt,
    });

    const cancelled = await appointmentCancel(appointment.id);
    expect(cancelled.status).toBe("CANCELLED");

    const del = await prisma.outboxEvent.findFirst({
      where: {
        aggregateId: appointment.id,
        eventType: "calendar.delete",
      },
    });
    expect(del).toBeTruthy();
  });

  it("finalizeCalendarUpsert stores googleEventId", async () => {
    const clientRequestId = `${prefix}:finalize`;
    const startsAt = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000);
    const endsAt = new Date(startsAt.getTime() + 60 * 60 * 1000);
    const { appointment } = await appointmentCreate({
      clientRequestId,
      leadId,
      assignedCuratorId: curatorId,
      startsAt,
      endsAt,
    });

    const eventId = deterministicGoogleEventId(appointment.id);
    // Avoid Telegram side-effect: no conversationId on this appointment.
    const updated = await finalizeCalendarUpsert(appointment.id, eventId);
    expect(updated.googleEventId).toBe(eventId);
    expect(updated.status).toBe("CONFIRMED");
  });
});
