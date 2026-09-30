import { describe, expect, it } from "vitest";
import type { sendUnsentRunDraft } from "../deliver-draft";
import { HermesRunPendingError } from "../hermes-client";
import { dispatchHermesPollRun } from "../hermes-poll-run";

const env = {
  HERMES_API_URL: "http://hermes.railway.internal:8642",
  HERMES_API_KEY_INTAKE: "intake-secret",
};
const now = new Date("2026-09-27T12:00:00.000Z");

function harness(
  status = "RUNNING",
  options?: { messageId?: string; laterInbound?: boolean },
) {
  const state: {
    id: string;
    agentKey: string;
    status: string;
    hermesRunId: string | null;
    conversationId: string | null;
    startedAt: Date | null;
    outputJson: unknown;
    inputJson: { messageId?: string } | null;
    errorCode: string | null;
    completedAt?: Date;
  } = {
    id: "run-1",
    agentKey: "intake",
    status,
    hermesRunId: "hermes-9",
    conversationId: "conv-1",
    startedAt: new Date("2026-09-27T11:00:00.000Z"),
    outputJson: { drafts: [{ body: "Черновик" }] },
    inputJson: options?.messageId ? { messageId: options.messageId } : null,
    errorCode: null,
  };
  const grant = { agentRunId: "run-1", revokedAt: null as Date | null };
  const db = {
    agentRun: {
      findUnique: async () => state,
      updateMany: async ({ data }: { data: Record<string, unknown> }) => {
        if (state.status !== "RUNNING") return { count: 0 };
        Object.assign(state, data);
        return { count: 1 };
      },
    },
    agentCapabilityGrant: {
      updateMany: async ({ data }: { data: { revokedAt: Date } }) => {
        if (grant.revokedAt) return { count: 0 };
        grant.revokedAt = data.revokedAt;
        return { count: 1 };
      },
    },
    conversationMessage: {
      findFirst: async (args?: { where?: { createdAt?: unknown; id?: unknown } }) => {
        if (!options?.laterInbound) return null;
        if (args?.where?.createdAt) return { id: "message-later" };
        if (typeof args?.where?.id === "string") {
          return { createdAt: new Date("2026-09-27T11:00:00.000Z") };
        }
        return null;
      },
    },
  };
  return { db, state, grant };
}

describe("hermes.poll_run", () => {
  function spy() {
    const calls: Array<{ agentRunId: string; conversationId: string; outputJson: unknown }> = [];
    const deliverDraft: typeof sendUnsentRunDraft = async (_db, input) => {
      calls.push({
        agentRunId: input.agentRunId,
        conversationId: input.conversationId,
        outputJson: input.outputJson,
      });
      return { status: "sent" };
    };
    return { calls, deliverDraft };
  }

  it("defers while Hermes is still running and keeps the grant", async () => {
    const box = harness();
    const sent = spy();
    const fetchImpl = (async () =>
      new Response(JSON.stringify({ status: "running" }), { status: 200 })) as typeof fetch;
    await expect(
      dispatchHermesPollRun(box.db as never, "run-1", {
        env,
        fetchImpl,
        now,
        deliverDraft: sent.deliverDraft,
      }),
    ).rejects.toBeInstanceOf(HermesRunPendingError);
    expect(box.state.status).toBe("RUNNING");
    expect(box.grant.revokedAt).toBeNull();
    expect(sent.calls).toEqual([]);
  });

  it("sends the stored draft when Hermes completes, then revokes the grant", async () => {
    const box = harness();
    const sent = spy();
    const fetchImpl = (async () =>
      new Response(
        JSON.stringify({ status: "completed", output: "Готово", usage: { input_tokens: 2, output_tokens: 5 } }),
        { status: 200 },
      )) as typeof fetch;
    await expect(
      dispatchHermesPollRun(box.db as never, "run-1", {
        env,
        fetchImpl,
        now,
        deliverDraft: sent.deliverDraft,
      }),
    ).resolves.toEqual({ status: "completed" });
    expect(sent.calls).toEqual([
      {
        agentRunId: "run-1",
        conversationId: "conv-1",
        outputJson: { drafts: [{ body: "Черновик" }] },
      },
    ]);
    expect(box.state.status).toBe("COMPLETED");
    expect(box.state.outputJson).toEqual({
      drafts: [{ body: "Черновик" }],
      hermesOutput: "Готово",
    });
    expect(box.grant.revokedAt).toEqual(now);
  });

  it("drops the reply when a newer client message arrived while it was being prepared", async () => {
    const box = harness("RUNNING", { messageId: "message-1", laterInbound: true });
    const sent = spy();
    let fetched = false;
    const fetchImpl = (async () => {
      fetched = true;
      return new Response(JSON.stringify({ status: "completed", output: "Готово" }), { status: 200 });
    }) as typeof fetch;
    await expect(
      dispatchHermesPollRun(box.db as never, "run-1", {
        env,
        fetchImpl,
        now,
        deliverDraft: sent.deliverDraft,
      }),
    ).resolves.toEqual({ status: "skipped" });
    expect(fetched).toBe(false);
    expect(sent.calls).toEqual([]);
    expect(box.state.status).toBe("COMPLETED");
    expect(box.state.errorCode).toBe("later_client_message");
    expect(box.grant.revokedAt).toEqual(now);
  });

  it("leaves the run running when sending the draft fails", async () => {
    const box = harness();
    const deliverDraft: typeof sendUnsentRunDraft = async () => {
      throw new Error("telegram down");
    };
    const fetchImpl = (async () =>
      new Response(JSON.stringify({ status: "completed", output: "Готово" }), { status: 200 })) as typeof fetch;
    await expect(
      dispatchHermesPollRun(box.db as never, "run-1", { env, fetchImpl, now, deliverDraft }),
    ).rejects.toThrow("telegram down");
    expect(box.state.status).toBe("RUNNING");
    expect(box.grant.revokedAt).toBeNull();
  });

  it("writes the calendar when a scheduling run ends without the tool", async () => {
    const outbox: string[] = [];
    const state = {
      id: "run-1",
      agentKey: "scheduling",
      status: "RUNNING",
      hermesRunId: "hermes-9",
      conversationId: "conv-1",
      startedAt: new Date("2026-09-27T11:00:00.000Z"),
      outputJson: {} as Record<string, unknown>,
      inputJson: { appointmentId: "appt-1" },
      errorCode: null as string | null,
    };
    const db = {
      agentRun: {
        findUnique: async () => state,
        update: async ({ data }: { data: { outputJson: Record<string, unknown> } }) => {
          state.outputJson = data.outputJson;
          return state;
        },
        updateMany: async ({ data }: { data: Record<string, unknown> }) => {
          Object.assign(state, data);
          return { count: 1 };
        },
      },
      agentCapabilityGrant: {
        updateMany: async () => ({ count: 1 }),
      },
      appointment: {
        findUnique: async () => ({ id: "appt-1", status: "PENDING", version: 1 }),
      },
      outboxEvent: {
        findUnique: async () => null,
        create: async ({ data }: { data: { eventType: string } }) => {
          outbox.push(data.eventType);
          return { id: "out-1" };
        },
      },
    };
    const fetchImpl = (async () =>
      new Response(JSON.stringify({ status: "completed", output: "done" }), {
        status: 200,
      })) as typeof fetch;
    await expect(
      dispatchHermesPollRun(db as never, "run-1", {
        env: {
          HERMES_API_URL: "http://hermes.railway.internal:8642",
          HERMES_API_KEY_SCHEDULING: "scheduling-secret",
        },
        fetchImpl,
        now,
        deliverDraft: async () => {
          throw new Error("scheduling must not send Telegram");
        },
      }),
    ).resolves.toEqual({ status: "completed" });
    expect(outbox).toEqual(["calendar.upsert"]);
    expect(state.status).toBe("COMPLETED");
    expect(state.outputJson).toMatchObject({ consultationCommitted: true, appointmentId: "appt-1" });
  });

  function schedulingFailureBox(appointmentStatus = "PENDING") {
    const outbox: string[] = [];
    const state = {
      id: "run-1",
      agentKey: "scheduling",
      status: "RUNNING",
      hermesRunId: "hermes-9",
      conversationId: "conv-1",
      startedAt: new Date("2026-09-27T11:00:00.000Z"),
      outputJson: {} as Record<string, unknown>,
      inputJson: { appointmentId: "appt-1" },
      errorCode: null as string | null,
    };
    const db = {
      agentRun: {
        findUnique: async () => state,
        update: async ({ data }: { data: { outputJson: Record<string, unknown> } }) => {
          state.outputJson = data.outputJson;
          return state;
        },
        updateMany: async ({ data }: { data: Record<string, unknown> }) => {
          Object.assign(state, data);
          return { count: 1 };
        },
      },
      agentCapabilityGrant: {
        updateMany: async () => ({ count: 1 }),
      },
      appointment: {
        findUnique: async () => ({ id: "appt-1", status: appointmentStatus, version: 1 }),
      },
      outboxEvent: {
        findUnique: async () => null,
        create: async ({ data }: { data: { eventType: string } }) => {
          outbox.push(data.eventType);
          return { id: "out-1" };
        },
      },
    };
    return { db, state, outbox };
  }

  it("writes the calendar when a scheduling run fails in Hermes", async () => {
    const box = schedulingFailureBox();
    const fetchImpl = (async () =>
      new Response(JSON.stringify({ status: "failed", message: "boom" }), { status: 200 })) as typeof fetch;
    await expect(
      dispatchHermesPollRun(box.db as never, "run-1", {
        env: {
          HERMES_API_URL: "http://hermes.railway.internal:8642",
          HERMES_API_KEY_SCHEDULING: "scheduling-secret",
        },
        fetchImpl,
        now,
        deliverDraft: async () => {
          throw new Error("scheduling must not send Telegram");
        },
      }),
    ).resolves.toEqual({ status: "failed", errorCode: "hermes_failed" });
    expect(box.outbox).toEqual(["calendar.upsert"]);
    expect(box.state.status).toBe("FAILED");
    expect(box.state.outputJson).toMatchObject({ consultationCommitted: true, appointmentId: "appt-1" });
  });

  it("writes the calendar when the scheduling poll gets a terminal HTTP error", async () => {
    const box = schedulingFailureBox();
    const fetchImpl = (async () =>
      new Response(JSON.stringify({ message: "unauthorized" }), { status: 401 })) as typeof fetch;
    await expect(
      dispatchHermesPollRun(box.db as never, "run-1", {
        env: {
          HERMES_API_URL: "http://hermes.railway.internal:8642",
          HERMES_API_KEY_SCHEDULING: "scheduling-secret",
        },
        fetchImpl,
        now,
        deliverDraft: async () => {
          throw new Error("scheduling must not send Telegram");
        },
      }),
    ).resolves.toEqual({ status: "failed", errorCode: "http_401" });
    expect(box.outbox).toEqual(["calendar.upsert"]);
    expect(box.state.outputJson).toMatchObject({ consultationCommitted: true });
  });

  it("does not write the calendar when the booked appointment is cancelled", async () => {
    const box = schedulingFailureBox("CANCELLED");
    const fetchImpl = (async () =>
      new Response(JSON.stringify({ status: "failed", message: "boom" }), { status: 200 })) as typeof fetch;
    await expect(
      dispatchHermesPollRun(box.db as never, "run-1", {
        env: {
          HERMES_API_URL: "http://hermes.railway.internal:8642",
          HERMES_API_KEY_SCHEDULING: "scheduling-secret",
        },
        fetchImpl,
        now,
      }),
    ).resolves.toEqual({ status: "failed", errorCode: "hermes_failed" });
    expect(box.outbox).toEqual([]);
    expect(box.state.outputJson).not.toMatchObject({ consultationCommitted: true });
  });

  it("fails the local run when Hermes reports failed or cancelled", async () => {
    const failed = harness();
    const fetchFailed = (async () =>
      new Response(JSON.stringify({ status: "failed", message: "boom" }), { status: 200 })) as typeof fetch;
    const failedSpy = spy();
    await expect(
      dispatchHermesPollRun(failed.db as never, "run-1", {
        env,
        fetchImpl: fetchFailed,
        now,
        deliverDraft: failedSpy.deliverDraft,
      }),
    ).resolves.toEqual({ status: "failed", errorCode: "hermes_failed" });
    expect(failedSpy.calls).toEqual([]);
    expect(failed.state.status).toBe("FAILED");
    expect(failed.grant.revokedAt).toEqual(now);

    const cancelled = harness();
    const fetchCancelled = (async () =>
      new Response(JSON.stringify({ status: "cancelled" }), { status: 200 })) as typeof fetch;
    await expect(
      dispatchHermesPollRun(cancelled.db as never, "run-1", {
        env,
        fetchImpl: fetchCancelled,
        now,
        deliverDraft: spy().deliverDraft,
      }),
    ).resolves.toEqual({ status: "failed", errorCode: "hermes_cancelled" });
    expect(cancelled.state.status).toBe("FAILED");
    expect(cancelled.grant.revokedAt).toEqual(now);
  });
});
