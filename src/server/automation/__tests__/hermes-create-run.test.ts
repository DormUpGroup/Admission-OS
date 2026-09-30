import { describe, expect, it } from "vitest";
import { HermesNotConfiguredError, HermesRetryableError } from "../hermes-client";
import { formatLeadCard } from "../capability-grant";
import {
  dispatchHermesCreateRun,
  enqueueHermesCreateRun,
  enqueueQueuedHermesCreateRuns,
  hermesCreateRunIdempotencyKey,
} from "../hermes-create-run";

const env = {
  HERMES_API_URL: "http://hermes.railway.internal:8642",
  HERMES_API_KEY_INTAKE: "intake-secret",
};

const now = new Date("2026-09-27T08:00:00.000Z");

type RunRow = {
  id: string;
  agentKey: string;
  status: string;
  hermesRunId: string | null;
  idempotencyKey: string;
  conversationId: string | null;
  inputJson: { messageId?: string; appointmentId?: string };
  outputJson?: unknown;
  queuedAt?: Date;
};

const bookedAppointment = {
  id: "appt-1",
  status: "PENDING",
  version: 3,
  title: "Консультация",
  startsAt: new Date("2026-10-01T10:00:00.000Z"),
  endsAt: new Date("2026-10-01T10:30:00.000Z"),
  timezone: "Europe/Rome",
  guestName: "Аня",
  guestEmail: "anya@example.com",
  assignedCuratorId: null as string | null,
};

type GrantRow = {
  id: string;
  agentRunId: string;
  conversationId: string;
  allowedToolsJson: string[];
  expiresAt: Date;
  revokedAt: Date | null;
  createdAt?: Date;
};

function harness(options: {
  run: RunRow;
  body?: string | null;
  hermesSessionId?: string | null;
  fetchImpl?: typeof fetch;
  appointment?: typeof bookedAppointment | null;
  uniqueConflict?: boolean;
  laterInbound?: boolean;
  messages?: Array<{ direction: string; body: string | null }>;
}) {
  const outboxCreates: Array<{ eventType: string; idempotencyKey: string }> = [];
  const runUpdates: Array<Record<string, unknown>> = [];
  const grants: GrantRow[] = [];
  let sessionId = options.hermesSessionId ?? null;
  const state: RunRow = { ...options.run };
  let uniqueConflictThrown = false;

  const db = {
    outboxEvent: {
      findUnique: async ({ where }: { where: { idempotencyKey: string } }) =>
        outboxCreates.find((row) => row.idempotencyKey === where.idempotencyKey) ?? null,
      create: async ({
        data,
      }: {
        data: { eventType: string; idempotencyKey: string };
      }) => {
        if (data.eventType === "telegram.send") {
          throw new Error("client send is not allowed");
        }
        outboxCreates.push({
          eventType: data.eventType,
          idempotencyKey: data.idempotencyKey,
        });
        return { id: "outbox-1", ...data };
      },
    },
    agentRun: {
      findUnique: async () => ({ ...state }),
      findMany: async () => (state.status === "QUEUED" && !state.hermesRunId ? [state] : []),
      update: async ({ data }: { data: { outputJson?: unknown } }) => {
        if (data.outputJson !== undefined) state.outputJson = data.outputJson;
        return { ...state };
      },
      updateMany: async ({ data }: { data: Record<string, unknown> }) => {
        if (options.uniqueConflict && !uniqueConflictThrown) {
          uniqueConflictThrown = true;
          const error = new Error("unique") as Error & { code?: string };
          error.code = "P2002";
          throw error;
        }
        if (state.status !== "QUEUED" || state.hermesRunId) return { count: 0 };
        Object.assign(state, data);
        runUpdates.push(data);
        return { count: 1 };
      },
    },
    appointment: {
      findUnique: async () => options.appointment ?? null,
    },
    user: {
      findUnique: async () => null,
    },
    conversation: {
      findUnique: async () => ({
        id: "conversation-1",
        hermesSessionId: sessionId,
        lead: {
          firstName: "Аня",
          lastName: null,
          locale: "ru",
          qualificationJson: { studyLevel: "бакалавриат" },
        },
      }),
      update: async ({ data }: { data: { hermesSessionId?: string } }) => {
        if (data.hermesSessionId) sessionId = data.hermesSessionId;
        return { id: "conversation-1", hermesSessionId: sessionId };
      },
    },
    conversationMessage: {
      findFirst: async (args?: { where?: { id?: unknown; createdAt?: unknown } }) => {
        const where = args?.where ?? {};
        const body = options.body === undefined ? "Хочу поступить" : options.body;
        if (where.createdAt) return options.laterInbound ? { id: "message-later" } : null;
        if (where.id) {
          return { id: "message-1", body, createdAt: new Date("2026-09-27T07:59:00.000Z") };
        }
        return { body };
      },
      findMany: async () =>
        options.messages ?? [
          { direction: "INBOUND", body: options.body === undefined ? "Хочу поступить" : options.body },
          { direction: "OUTBOUND", body: "Какой уровень вас интересует?" },
          { direction: "INBOUND", body: "Бакалавриат" },
        ],
    },
    agentCapabilityGrant: {
      findUnique: async ({ where }: { where: { agentRunId?: string; id?: string } }) =>
        grants.find((row) =>
          where.agentRunId ? row.agentRunId === where.agentRunId : row.id === where.id,
        ) ?? null,
      create: async ({ data }: { data: GrantRow }) => {
        if (grants.some((row) => row.agentRunId === data.agentRunId)) {
          const error = new Error("unique") as Error & { code?: string };
          error.code = "P2002";
          throw error;
        }
        const row = { ...data, revokedAt: data.revokedAt ?? null };
        grants.push(row);
        return row;
      },
      update: async ({
        where,
        data,
      }: {
        where: { agentRunId: string };
        data: Partial<GrantRow>;
      }) => {
        const row = grants.find((item) => item.agentRunId === where.agentRunId);
        if (!row) throw new Error("grant not found");
        Object.assign(row, data);
        return row;
      },
      updateMany: async ({
        where,
        data,
      }: {
        where: { agentRunId: string; revokedAt: null };
        data: { revokedAt: Date };
      }) => {
        const row = grants.find(
          (item) => item.agentRunId === where.agentRunId && item.revokedAt == null,
        );
        if (!row) return { count: 0 };
        Object.assign(row, data);
        return { count: 1 };
      },
    },
  };

  return {
    db,
    state,
    outboxCreates,
    runUpdates,
    grants,
    session: () => sessionId,
  };
}

describe("hermes.create_run dispatch", () => {
  it("enqueues one outbox row per agent run", async () => {
    const { db, outboxCreates } = harness({
      run: {
        id: "run-1",
        agentKey: "intake",
        status: "QUEUED",
        hermesRunId: null,
        idempotencyKey: "agent:intake:event-1",
        conversationId: "conversation-1",
        inputJson: { messageId: "message-1" },
      },
    });
    await enqueueHermesCreateRun(db as never, "run-1");
    await enqueueHermesCreateRun(db as never, "run-1");
    expect(outboxCreates).toEqual([
      { eventType: "hermes.create_run", idempotencyKey: hermesCreateRunIdempotencyKey("run-1") },
    ]);
  });

  it("sweeps queued intake runs that have no hermesRunId", async () => {
    const { db, outboxCreates } = harness({
      run: {
        id: "run-queued",
        agentKey: "intake",
        status: "QUEUED",
        hermesRunId: null,
        idempotencyKey: "agent:intake:event-2",
        conversationId: "conversation-1",
        inputJson: {},
        queuedAt: now,
      },
    });
    await expect(enqueueQueuedHermesCreateRuns(db as never, 25)).resolves.toBe(1);
    expect(outboxCreates[0]?.idempotencyKey).toBe("hermes.create_run:run-queued");
  });

  it("marks RUNNING with hermesRunId and does not send to the client", async () => {
    let fetchCalls = 0;
    const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
      fetchCalls += 1;
      expect(String(url)).toBe("http://hermes.railway.internal:8642/p/intake/v1/runs");
      const sent = JSON.parse(String(init?.body)) as {
        input: string;
        session_id: string;
        instructions: string;
      };
      expect(sent.input).toBe("Хочу поступить");
      expect(sent.session_id).toBe("run-1");
      expect(sent.instructions).toContain("Хочу поступить");
      expect(sent.instructions).toContain("Бакалавриат");
      expect(sent.instructions).toContain("Какой уровень вас интересует?");
      expect(sent.instructions).toContain("one next turn");
      expect(sent.instructions).toContain("Name: Аня");
      expect(sent.instructions).toContain("studyLevel: бакалавриат");
      expect(sent.instructions).toContain(
        "Missing: educationLevel, targetField, desiredIntake, citizenship, passport, diploma, apostilleTranslation, budget",
      );
      expect(sent.instructions).toContain("The study destination is always Italy");
      expect(sent.instructions).not.toContain("preferredCountry");
      expect(sent.instructions).toContain("get_conversation_context");
      expect(sent.instructions).toContain("get_contact_profile");
      expect(sent.instructions).toContain("update_lead_qualification");
      expect(sent.instructions).toContain("send_client_message");
      expect(sent.instructions).toContain("send_booking_link");
      expect(sent.instructions).toContain("Do not offer days or times");
      expect(sent.instructions).toContain("Next: Ask only this fact: educationLevel");
      expect(sent.instructions).toContain("More questions remain after this one");
      expect(sent.instructions).toContain("Never ask a Known fact again");
      expect(sent.instructions).toContain("escalate_to_human");
      expect(sent.instructions).toContain("the one action the curator should take");
      expect(sent.instructions).toContain("propose_reply");
      expect(sent.instructions).toContain("The server sends that text when the turn ends");
      expect(sent.instructions).toContain("You are a girl");
      expect(sent.instructions).toContain("поняла, передала");
      expect(sent.instructions).toContain("do not greet again");
      expect(sent.instructions).toContain("one thought");
      expect(sent.instructions).toContain("repeats the previous client message");
      expect(sent.instructions).toContain("answer immediately");
      expect(sent.instructions).toContain("1599 €");
      expect(sent.instructions).toContain("third explicit request");
      expect(sent.instructions).toContain("the curator will answer this");
      expect(sent.instructions).not.toContain("Do not put prices");
      expect(sent.instructions).toContain("Sound like a person");
      expect(sent.instructions).toContain("<b>word</b>");
      expect(sent.instructions).toContain("at most one in a message");
      expect(sent.instructions).toContain("send_booking_link");
      expect(sent.instructions).toContain("Do not offer days or times");
      expect(sent.instructions).not.toMatch(/\d{4}-\d{2}-\d{2}T/);
      return new Response(JSON.stringify({ run_id: "hermes-9", status: "started" }), {
        status: 202,
      });
    }) as typeof fetch;

    const box = harness({
      run: {
        id: "run-1",
        agentKey: "intake",
        status: "QUEUED",
        hermesRunId: null,
        idempotencyKey: "agent:intake:event-1",
        conversationId: "conversation-1",
        inputJson: { messageId: "message-1" },
      },
      hermesSessionId: "old-conversation-session",
      fetchImpl,
    });

    await expect(
      dispatchHermesCreateRun(box.db as never, "run-1", { env, fetchImpl, now }),
    ).resolves.toEqual({ status: "running", hermesRunId: "hermes-9" });

    expect(fetchCalls).toBe(1);
    expect(box.state.status).toBe("RUNNING");
    expect(box.state.hermesRunId).toBe("hermes-9");
    expect(box.outboxCreates).toEqual([
      { eventType: "hermes.poll_run", idempotencyKey: "hermes.poll_run:run-1" },
    ]);
    expect(box.grants[0]?.revokedAt).toBeNull();
    expect(box.session()).toBe("old-conversation-session");
  });

  it("sends one thought when several client messages arrived in a row", async () => {
    let sentInput = "";
    const fetchImpl = (async (_url: string | URL | Request, init?: RequestInit) => {
      sentInput = (JSON.parse(String(init?.body)) as { input: string }).input;
      return new Response(JSON.stringify({ run_id: "hermes-burst", status: "started" }), {
        status: 202,
      });
    }) as typeof fetch;
    const box = harness({
      run: {
        id: "run-1",
        agentKey: "intake",
        status: "QUEUED",
        hermesRunId: null,
        idempotencyKey: "agent:intake:event-burst",
        conversationId: "conversation-1",
        inputJson: { messageId: "message-3" },
      },
      body: "Турин",
      messages: [
        { direction: "INBOUND", body: "Турин" },
        { direction: "INBOUND", body: "Право" },
        { direction: "INBOUND", body: "Магистратура" },
        { direction: "OUTBOUND", body: "Какой уровень вас интересует?" },
      ],
      fetchImpl,
    });
    await dispatchHermesCreateRun(box.db as never, "run-1", { env, fetchImpl, now });
    expect(sentInput).toBe("Магистратура\nПраво\nТурин");
  });

  it("does not start Hermes when a newer client message is already stored", async () => {
    let fetchCalls = 0;
    const fetchImpl = (async () => {
      fetchCalls += 1;
      return new Response(JSON.stringify({ run_id: "hermes-no", status: "started" }), { status: 202 });
    }) as typeof fetch;
    const box = harness({
      run: {
        id: "run-1",
        agentKey: "intake",
        status: "QUEUED",
        hermesRunId: null,
        idempotencyKey: "agent:intake:event-old",
        conversationId: "conversation-1",
        inputJson: { messageId: "message-1" },
      },
      laterInbound: true,
      fetchImpl,
    });
    await expect(
      dispatchHermesCreateRun(box.db as never, "run-1", { env, fetchImpl, now }),
    ).resolves.toEqual({ status: "skipped", hermesRunId: null });
    expect(fetchCalls).toBe(0);
    expect(box.state.status).toBe("COMPLETED");
  });

  it("does not call Hermes again once hermesRunId is stored", async () => {
    const box = harness({
      run: {
        id: "run-1",
        agentKey: "intake",
        status: "RUNNING",
        hermesRunId: "hermes-9",
        idempotencyKey: "agent:intake:event-1",
        conversationId: "conversation-1",
        inputJson: { messageId: "message-1" },
      },
    });
    await expect(
      dispatchHermesCreateRun(box.db as never, "run-1", {
        env,
        now,
        fetchImpl: (async () => {
          throw new Error("fetch should not run");
        }) as typeof fetch,
      }),
    ).resolves.toEqual({ status: "skipped", hermesRunId: "hermes-9" });
    expect(box.runUpdates).toEqual([]);
    expect(box.outboxCreates).toEqual([
      { eventType: "hermes.poll_run", idempotencyKey: "hermes.poll_run:run-1" },
    ]);
  });

  it("leaves QUEUED on 503", async () => {
    const box = harness({
      run: {
        id: "run-1",
        agentKey: "intake",
        status: "QUEUED",
        hermesRunId: null,
        idempotencyKey: "agent:intake:event-1",
        conversationId: "conversation-1",
        inputJson: { messageId: "message-1" },
      },
    });
    const fetchImpl = (async () =>
      new Response(JSON.stringify({ message: "unavailable" }), { status: 503 })) as typeof fetch;
    await expect(
      dispatchHermesCreateRun(box.db as never, "run-1", { env, fetchImpl, now }),
    ).rejects.toBeInstanceOf(HermesRetryableError);
    expect(box.state.status).toBe("QUEUED");
    expect(box.state.hermesRunId).toBeNull();
  });

  it("marks FAILED on 400 without sending to the client", async () => {
    const box = harness({
      run: {
        id: "run-1",
        agentKey: "intake",
        status: "QUEUED",
        hermesRunId: null,
        idempotencyKey: "agent:intake:event-1",
        conversationId: "conversation-1",
        inputJson: { messageId: "message-1" },
      },
    });
    const fetchImpl = (async () =>
      new Response(JSON.stringify({ message: "bad request" }), { status: 400 })) as typeof fetch;
    await expect(
      dispatchHermesCreateRun(box.db as never, "run-1", { env, fetchImpl, now }),
    ).resolves.toEqual({ status: "failed", errorCode: "http_400" });
    expect(box.state.status).toBe("FAILED");
    expect(box.state.hermesRunId).toBeNull();
    expect(box.outboxCreates).toEqual([]);
    expect(box.grants[0]?.revokedAt).toEqual(now);
  });

  it("queues the calendar when scheduling create gets a terminal HTTP error", async () => {
    const box = harness({
      run: {
        id: "run-1",
        agentKey: "scheduling",
        status: "QUEUED",
        hermesRunId: null,
        idempotencyKey: "agent:scheduling:appt-1",
        conversationId: "conversation-1",
        inputJson: { appointmentId: "appt-1" },
      },
      appointment: bookedAppointment,
    });
    const fetchImpl = (async () =>
      new Response(JSON.stringify({ message: "unauthorized" }), { status: 401 })) as typeof fetch;
    await expect(
      dispatchHermesCreateRun(box.db as never, "run-1", {
        env: {
          HERMES_API_URL: "http://hermes.railway.internal:8642",
          HERMES_API_KEY_SCHEDULING: "scheduling-secret",
        },
        fetchImpl,
        now,
      }),
    ).resolves.toEqual({ status: "failed", errorCode: "http_401" });
    expect(box.state.status).toBe("FAILED");
    expect(box.outboxCreates).toEqual([
      { eventType: "calendar.upsert", idempotencyKey: "calendar.upsert:appt-1:v3" },
    ]);
    expect(box.state.outputJson).toMatchObject({
      consultationCommitted: true,
      appointmentId: "appt-1",
    });
  });

  it("does not queue the calendar when scheduling create is retryable", async () => {
    const box = harness({
      run: {
        id: "run-1",
        agentKey: "scheduling",
        status: "QUEUED",
        hermesRunId: null,
        idempotencyKey: "agent:scheduling:appt-1",
        conversationId: "conversation-1",
        inputJson: { appointmentId: "appt-1" },
      },
      appointment: bookedAppointment,
    });
    const fetchImpl = (async () =>
      new Response(JSON.stringify({ message: "unavailable" }), { status: 503 })) as typeof fetch;
    await expect(
      dispatchHermesCreateRun(box.db as never, "run-1", {
        env: {
          HERMES_API_URL: "http://hermes.railway.internal:8642",
          HERMES_API_KEY_SCHEDULING: "scheduling-secret",
        },
        fetchImpl,
        now,
      }),
    ).rejects.toBeInstanceOf(HermesRetryableError);
    expect(box.state.status).toBe("QUEUED");
    expect(box.outboxCreates).toEqual([]);
  });

  it("does not queue the calendar when the booked appointment is already cancelled", async () => {
    const box = harness({
      run: {
        id: "run-1",
        agentKey: "scheduling",
        status: "QUEUED",
        hermesRunId: null,
        idempotencyKey: "agent:scheduling:appt-1",
        conversationId: "conversation-1",
        inputJson: { appointmentId: "appt-1" },
      },
      appointment: { ...bookedAppointment, status: "CANCELLED" },
    });
    await expect(
      dispatchHermesCreateRun(box.db as never, "run-1", {
        env: {
          HERMES_API_URL: "http://hermes.railway.internal:8642",
          HERMES_API_KEY_SCHEDULING: "scheduling-secret",
        },
        fetchImpl: (async () => {
          throw new Error("Hermes should not be called");
        }) as typeof fetch,
        now,
      }),
    ).resolves.toEqual({ status: "failed", errorCode: "missing_appointment" });
    expect(box.outboxCreates).toEqual([]);
  });

  it("queues the calendar when storing the Hermes run id conflicts", async () => {
    const box = harness({
      run: {
        id: "run-1",
        agentKey: "scheduling",
        status: "QUEUED",
        hermesRunId: null,
        idempotencyKey: "agent:scheduling:appt-1",
        conversationId: "conversation-1",
        inputJson: { appointmentId: "appt-1" },
      },
      appointment: bookedAppointment,
      uniqueConflict: true,
    });
    const fetchImpl = (async () =>
      new Response(JSON.stringify({ run_id: "hermes-1", session_id: "sess-1" }), {
        status: 200,
      })) as typeof fetch;
    await expect(
      dispatchHermesCreateRun(box.db as never, "run-1", {
        env: {
          HERMES_API_URL: "http://hermes.railway.internal:8642",
          HERMES_API_KEY_SCHEDULING: "scheduling-secret",
        },
        fetchImpl,
        now,
      }),
    ).resolves.toEqual({ status: "failed", errorCode: "duplicate_hermes_run" });
    expect(box.outboxCreates).toEqual([
      { eventType: "calendar.upsert", idempotencyKey: "calendar.upsert:appt-1:v3" },
    ]);
    expect(box.state.status).toBe("FAILED");
    expect(box.state.outputJson).toMatchObject({ consultationCommitted: true });
  });

  it("does not mark FAILED when Hermes is not configured", async () => {
    const box = harness({
      run: {
        id: "run-1",
        agentKey: "intake",
        status: "QUEUED",
        hermesRunId: null,
        idempotencyKey: "agent:intake:event-1",
        conversationId: "conversation-1",
        inputJson: { messageId: "message-1" },
      },
    });
    await expect(
      dispatchHermesCreateRun(box.db as never, "run-1", {
        env: {},
        now,
        fetchImpl: (async () => {
          throw new Error("fetch should not run");
        }) as typeof fetch,
      }),
    ).rejects.toBeInstanceOf(HermesNotConfiguredError);
    expect(box.state.status).toBe("QUEUED");
    expect(box.runUpdates).toEqual([]);
    expect(box.grants).toEqual([]);
  });

  it("reuses the same grant id when create_run is retried", async () => {
    const bodies: string[] = [];
    let attempts = 0;
    const fetchImpl = (async (_url: string | URL | Request, init?: RequestInit) => {
      attempts += 1;
      bodies.push(String(init?.body));
      if (attempts === 1) {
        return new Response(JSON.stringify({ message: "unavailable" }), { status: 503 });
      }
      return new Response(JSON.stringify({ run_id: "hermes-9", status: "started" }), {
        status: 202,
      });
    }) as typeof fetch;
    const box = harness({
      run: {
        id: "run-1",
        agentKey: "intake",
        status: "QUEUED",
        hermesRunId: null,
        idempotencyKey: "agent:intake:event-1",
        conversationId: "conversation-1",
        inputJson: { messageId: "message-1" },
      },
      fetchImpl,
    });
    await expect(
      dispatchHermesCreateRun(box.db as never, "run-1", { env, fetchImpl, now }),
    ).rejects.toBeInstanceOf(HermesRetryableError);
    await expect(
      dispatchHermesCreateRun(box.db as never, "run-1", {
        env,
        fetchImpl,
        now: new Date(now.getTime() + 60_000),
      }),
    ).resolves.toEqual({ status: "running", hermesRunId: "hermes-9" });
    expect(box.grants).toHaveLength(1);
    const grantId = box.grants[0]?.id ?? "";
    expect(JSON.parse(bodies[0] ?? "{}").instructions).toContain(grantId);
    expect(JSON.parse(bodies[1] ?? "{}").instructions).toBe(
      JSON.parse(bodies[0] ?? "{}").instructions,
    );
  });
});

describe("formatLeadCard", () => {
  it("offers the booking link when the chat already answered and the client agreed", () => {
    const card = formatLeadCard({ firstName: "Mike", lastName: "Bilak", locale: "ru" }, [
      { direction: "OUTBOUND", body: "Какое у вас гражданство?" },
      { direction: "INBOUND", body: "Украина и Израиль" },
      { direction: "OUTBOUND", body: "Загранпаспорт уже есть?" },
      { direction: "INBOUND", body: "Есть" },
      { direction: "OUTBOUND", body: "Аттестат уже на руках?" },
      { direction: "INBOUND", body: "Аттестат есть" },
      { direction: "OUTBOUND", body: "Апостиль уже есть?" },
      { direction: "INBOUND", body: "Апостиль есть" },
      { direction: "OUTBOUND", body: "Перевод уже готов?" },
      { direction: "INBOUND", body: "Есть есть все есть" },
      { direction: "OUTBOUND", body: "Хотите, передам вас куратору?" },
      { direction: "INBOUND", body: "Давайте" },
      { direction: "OUTBOUND", body: "Какое у вас гражданство?" },
      { direction: "INBOUND", body: "Я же уже говорил" },
    ]);
    expect(card).toContain("citizenship: Украина и Израиль");
    expect(card).toContain("passport: есть");
    expect(card).toContain("diploma: есть");
    expect(card).toContain("apostilleTranslation: апостиль и перевод есть");
    expect(card).toContain("Хотите консультацию?");
    expect(card).toContain("Do not send the booking link until they say yes");
    expect(card).not.toContain("Next: Send the booking link now");
  });

  it("sends the link only after the client says yes to a consultation", () => {
    const card = formatLeadCard(null, [
      { direction: "OUTBOUND", body: "Какое у вас гражданство?" },
      { direction: "INBOUND", body: "Украина" },
      { direction: "OUTBOUND", body: "Загранпаспорт уже есть?" },
      { direction: "INBOUND", body: "Есть" },
      { direction: "OUTBOUND", body: "Аттестат уже на руках?" },
      { direction: "INBOUND", body: "Аттестат есть" },
      { direction: "OUTBOUND", body: "Апостиль уже есть?" },
      { direction: "INBOUND", body: "Апостиль есть" },
      { direction: "OUTBOUND", body: "Перевод уже готов?" },
      { direction: "INBOUND", body: "Есть" },
      { direction: "OUTBOUND", body: "Хотите консультацию?" },
      { direction: "INBOUND", body: "Да" },
    ]);
    expect(card).toContain("Next: Send the booking link now");
  });

  it("explains and asks again when the client declines", () => {
    const card = formatLeadCard(null, [
      { direction: "OUTBOUND", body: "Какое у вас гражданство?" },
      { direction: "INBOUND", body: "Украина" },
      { direction: "OUTBOUND", body: "Загранпаспорт уже есть?" },
      { direction: "INBOUND", body: "Есть" },
      { direction: "OUTBOUND", body: "Аттестат уже на руках?" },
      { direction: "INBOUND", body: "Аттестат есть" },
      { direction: "OUTBOUND", body: "Апостиль уже есть?" },
      { direction: "INBOUND", body: "Апостиль есть" },
      { direction: "OUTBOUND", body: "Перевод уже готов?" },
      { direction: "INBOUND", body: "Есть" },
      { direction: "OUTBOUND", body: "Хотите консультацию?" },
      { direction: "INBOUND", body: "Нет" },
    ]);
    expect(card).toContain("The client declined");
    expect(card).toContain("ask once more");
    expect(card).not.toContain("Next: Send the booking link now");
  });

  it("asks for a consultation once the documents are known and the client has not agreed yet", () => {
    const card = formatLeadCard(null, [
      { direction: "OUTBOUND", body: "Какое у вас гражданство?" },
      { direction: "INBOUND", body: "Украина" },
      { direction: "OUTBOUND", body: "Загранпаспорт уже есть?" },
      { direction: "INBOUND", body: "Есть" },
      { direction: "OUTBOUND", body: "Аттестат уже на руках?" },
      { direction: "INBOUND", body: "Аттестат есть" },
      { direction: "OUTBOUND", body: "Апостиль уже есть?" },
      { direction: "INBOUND", body: "Апостиль есть" },
      { direction: "OUTBOUND", body: "Перевод уже готов?" },
      { direction: "INBOUND", body: "Есть" },
    ]);
    expect(card).toContain("Общая картина ясна.");
    expect(card).toContain("<b>130 €</b> / 1 час");
    expect(card).toContain("Хотите консультацию?");
    expect(card).toContain("Do not send the booking link until they say yes");
    expect(card).toContain("Missing:");
  });

  it("offers to start questions before asking a fact", () => {
    const card = formatLeadCard(null, [{ direction: "INBOUND", body: "Привет" }]);
    expect(card).toContain("Начнём?");
    expect(card).toContain("Do not ask a fact");
    expect(card).not.toContain("Ask only");
  });

  it("asks permission to ask questions after they say they are ready", () => {
    const card = formatLeadCard(null, [
      {
        direction: "OUTBOUND",
        body: "Здравствуйте.\n\nЯ помощник кураторов Immigrome.\n\nГотовы начать?",
      },
      { direction: "INBOUND", body: "Да" },
    ]);
    expect(card).toContain("Начнём?");
    expect(card).toContain("Do not ask a fact");
    expect(card).not.toContain("бакалавриат, магистратура, or foundation");
  });

  it("asks бакалавриат, магистратура, or foundation after they agree", () => {
    const card = formatLeadCard(null, [
      {
        direction: "OUTBOUND",
        body: "Если хотите, начнём: я задам несколько вопросов, чтобы понять, как лучше выстроить работу. Начнём?",
      },
      { direction: "INBOUND", body: "Да" },
    ]);
    expect(card).toContain("бакалавриат, магистратура, or foundation");
    expect(card).toContain("More questions remain after this one");
    expect(card).not.toContain("This is the last question");
    expect(card).not.toContain("Do not ask a fact");
  });

  it("explains the questions after one refusal and stops after the second", () => {
    const once = formatLeadCard(null, [
      {
        direction: "OUTBOUND",
        body: "Если хотите, начнём: я задам несколько вопросов, чтобы понять, как лучше выстроить работу. Начнём?",
      },
      { direction: "INBOUND", body: "Нет" },
    ]);
    expect(once).toContain("declined the questions");
    expect(once).toContain("не предлагать лишние шаги");
    expect(once).not.toContain("Ask only");

    const twice = formatLeadCard(null, [
      {
        direction: "OUTBOUND",
        body: "Если хотите, начнём: я задам несколько вопросов, чтобы понять, как лучше выстроить работу. Начнём?",
      },
      { direction: "INBOUND", body: "Нет" },
      {
        direction: "OUTBOUND",
        body: "Вопросы нужны, чтобы понять ваш случай и не предлагать лишние шаги.\n\nНачнём?",
      },
      { direction: "INBOUND", body: "Нет" },
    ]);
    expect(twice).toContain("declined the questions again");
    expect(twice).toContain("do not offer the questionnaire again");
  });

  it("calls the question last only when one questionnaire fact remains", () => {
    const card = formatLeadCard(
      {
        qualificationJson: {
          studyLevel: "Бакалавриат",
          educationLevel: "Школа",
          targetField: "Дизайн",
          desiredIntake: "2027/28",
          citizenship: "РФ",
          passport: "есть",
          diploma: "аттестат есть",
        },
      },
      [],
    );
    expect(card).toContain("Ask only this fact: apostilleTranslation");
    expect(card).toContain("This is the last question");
    expect(card).not.toContain("More questions remain");
  });

  it("skips the offer when the level was already named", () => {
    const card = formatLeadCard(null, [{ direction: "INBOUND", body: "Хочу на мастер" }]);
    expect(card).toContain("studyLevel: Магистратура");
    expect(card).toContain("Ask only this fact: educationLevel");
    expect(card).toContain("More questions remain after this one");
    expect(card).not.toContain("Начнём?");
  });
});
