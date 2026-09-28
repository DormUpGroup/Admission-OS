import { describe, expect, it } from "vitest";
import type { sendUnsentRunDraft } from "../deliver-draft";
import { HermesRunPendingError } from "../hermes-client";
import { dispatchHermesPollRun } from "../hermes-poll-run";

const env = {
  HERMES_API_URL: "http://hermes.railway.internal:8642",
  HERMES_API_KEY: "api-secret",
};
const now = new Date("2026-09-27T12:00:00.000Z");

function harness(status = "RUNNING") {
  const state: {
    id: string;
    status: string;
    hermesRunId: string | null;
    conversationId: string | null;
    startedAt: Date | null;
    outputJson: unknown;
    errorCode: string | null;
    completedAt?: Date;
  } = {
    id: "run-1",
    status,
    hermesRunId: "hermes-9",
    conversationId: "conv-1",
    startedAt: new Date("2026-09-27T11:00:00.000Z"),
    outputJson: { drafts: [{ body: "Черновик" }] },
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
