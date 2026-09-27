import { describe, expect, it } from "vitest";
import { AGENT_DEFINITIONS_BY_KEY } from "../registry";
import {
  decodeCapabilityJwtPayload,
  HermesNotConfiguredError,
  HermesRetryableError,
} from "../hermes-client";
import {
  dispatchHermesCreateRun,
  enqueueHermesCreateRun,
  enqueueQueuedHermesCreateRuns,
  hermesCreateRunIdempotencyKey,
} from "../hermes-create-run";

const env = {
  HERMES_API_URL: "http://hermes.railway.internal:8080",
  HERMES_API_KEY: "api-secret",
  HERMES_MCP_KEY: "mcp-secret",
  NEXTAUTH_URL: "https://os.example",
};

const now = new Date("2026-09-27T08:00:00.000Z");

type RunRow = {
  id: string;
  agentKey: string;
  status: string;
  hermesRunId: string | null;
  idempotencyKey: string;
  conversationId: string | null;
  inputJson: { messageId?: string };
  queuedAt?: Date;
};

function harness(options: {
  run: RunRow;
  body?: string | null;
  hermesSessionId?: string | null;
  fetchImpl?: typeof fetch;
}) {
  const outboxCreates: Array<{ eventType: string; idempotencyKey: string }> = [];
  const runUpdates: Array<Record<string, unknown>> = [];
  let sessionId = options.hermesSessionId ?? null;
  const state = { ...options.run };

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
      updateMany: async ({ data }: { data: Record<string, unknown> }) => {
        if (state.status !== "QUEUED" || state.hermesRunId) return { count: 0 };
        Object.assign(state, data);
        runUpdates.push(data);
        return { count: 1 };
      },
    },
    conversation: {
      findUnique: async () => ({
        id: "conversation-1",
        hermesSessionId: sessionId,
      }),
      update: async ({ data }: { data: { hermesSessionId?: string } }) => {
        if (data.hermesSessionId) sessionId = data.hermesSessionId;
        return { id: "conversation-1", hermesSessionId: sessionId };
      },
    },
    conversationMessage: {
      findFirst: async () =>
        options.body === undefined ? { body: "Хочу поступить" } : { body: options.body },
    },
  };

  return {
    db,
    state,
    outboxCreates,
    runUpdates,
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
    const fetchImpl = (async (_url: string | URL | Request, init?: RequestInit) => {
      fetchCalls += 1;
      const sent = JSON.parse(String(init?.body)) as {
        text: string;
        conversation_id: string;
        session_id: string;
        mcp_url: string;
        capability_jwt: string;
      };
      expect(sent.text).toBe("Хочу поступить");
      expect(sent.conversation_id).toBe("conversation-1");
      expect(sent.session_id).toBe("conversation-1");
      expect(sent.mcp_url).toBe("https://os.example/api/mcp");
      const claims = decodeCapabilityJwtPayload(sent.capability_jwt);
      expect(claims.agent_run_id).toBe("run-1");
      expect(claims.conversation_id).toBe("conversation-1");
      expect(claims.allowed_tools).toEqual(AGENT_DEFINITIONS_BY_KEY.get("intake")?.allowedTools);
      expect(claims.exp).toBe(Math.floor(now.getTime() / 1000) + 15 * 60);
      return new Response(JSON.stringify({ run_id: "hermes-9" }), { status: 200 });
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
    ).resolves.toEqual({ status: "running", hermesRunId: "hermes-9" });

    expect(fetchCalls).toBe(1);
    expect(box.state.status).toBe("RUNNING");
    expect(box.state.hermesRunId).toBe("hermes-9");
    expect(box.outboxCreates).toEqual([]);
    expect(box.session()).toBe("conversation-1");
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
  });
});
