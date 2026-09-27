import { createHash } from "crypto";
import { describe, expect, it } from "vitest";
import { MCP_V1_TOOLS } from "../capability-grant";
import { handleMcpPost, saveProposeReplyDraft } from "../mcp-server";

const bootstrap = "bootstrap-secret";
const env = { MCP_BOOTSTRAP_KEY: bootstrap };
const now = new Date("2026-09-27T12:00:00.000Z");

type Grant = {
  id: string;
  agentRunId: string;
  conversationId: string;
  allowedToolsJson: string[];
  expiresAt: Date;
  revokedAt: Date | null;
  agentRun: { id: string; agentKey: string; conversationId: string | null };
};

function grant(overrides: Partial<Grant> = {}): Grant {
  return {
    id: "grant-secret-value",
    agentRunId: "run-1",
    conversationId: "conversation-1",
    allowedToolsJson: [...MCP_V1_TOOLS],
    expiresAt: new Date(now.getTime() + 60_000),
    revokedAt: null,
    agentRun: { id: "run-1", agentKey: "intake", conversationId: "conversation-1" },
    ...overrides,
  };
}

function world(row: Grant | null, options?: { paused?: boolean }) {
  const calls = { context: [] as string[], profile: [] as string[], messages: 0 };
  let outputJson: unknown = { drafts: [{ body: "старый", createdAt: "2026-09-27T11:00:00.000Z" }] };
  const db = {
    agentCapabilityGrant: {
      findUnique: async ({ where }: { where: { id: string } }) =>
        row && where.id === row.id ? row : null,
    },
    conversation: {
      findUnique: async ({ where }: { where: { id: string } }) => ({
        id: where.id,
        channel: "TELEGRAM",
        automationPausedAt: options?.paused ? now : null,
        lead: { consentStatus: "GRANTED", channelIdentities: [{ channel: "TELEGRAM" }] },
        student: null,
      }),
    },
    agentRun: {
      findUnique: async () => ({ outputJson }),
      update: async ({ data }: { data: { outputJson: unknown } }) => {
        outputJson = data.outputJson;
        return { outputJson };
      },
    },
    conversationMessage: {
      create: async () => {
        calls.messages += 1;
        throw new Error("client message must not be created");
      },
    },
  };
  const executors = {
    getConversationContext: async (conversationId: string) => {
      calls.context.push(conversationId);
      return { id: conversationId, messages: [{ body: "Хочу поступить" }] };
    },
    getContactProfile: async (conversationId: string) => {
      calls.profile.push(conversationId);
      return { lead: { id: "lead-1", firstName: "Аня" } };
    },
    saveDraft: async (input: { agentRunId: string; body: string }) => {
      await saveProposeReplyDraft(db as never, { ...input, now });
    },
  };
  return { db, calls, executors, output: () => outputJson };
}

function call(name: string, args: Record<string, unknown>) {
  return { jsonrpc: "2.0", id: 7, method: "tools/call", params: { name, arguments: args } };
}

async function post(
  box: ReturnType<typeof world>,
  body: unknown,
  options?: { authorization?: string | null; log?: (line: string) => void },
) {
  return handleMcpPost({
    db: box.db as never,
    authorizationHeader:
      options && "authorization" in options ? (options.authorization ?? null) : `Bearer ${bootstrap}`,
    body,
    env,
    now,
    executors: box.executors,
    log: options?.log,
  });
}

describe("MCP capability grant", () => {
  it("lists only the v1 read and draft tools for the bootstrap key", async () => {
    const box = world(grant());
    const listed = await post(box, { jsonrpc: "2.0", id: 1, method: "tools/list" });
    const tools = (listed.body as { result: { tools: Array<{ name: string; inputSchema: { required: string[] } }> } })
      .result.tools;
    expect(tools.map((tool) => tool.name)).toEqual([...MCP_V1_TOOLS]);
    expect(tools.every((tool) => tool.inputSchema.required.includes("grant_id"))).toBe(true);
    expect(JSON.stringify(tools)).not.toContain("send_client_message");

    const init = await post(box, {
      jsonrpc: "2.0",
      id: 2,
      method: "initialize",
      params: { protocolVersion: "2025-03-26" },
    });
    expect(init.status).toBe(200);
    expect((init.body as { result: { protocolVersion: string } }).result.protocolVersion).toBe(
      "2025-03-26",
    );
  });

  it("rejects a missing bootstrap key before looking up a grant", async () => {
    const box = world(grant());
    box.db.agentCapabilityGrant.findUnique = async () => {
      throw new Error("grant lookup should not run");
    };
    const denied = await post(box, call("get_conversation_context", { grant_id: "grant-secret-value" }), {
      authorization: null,
    });
    expect(denied.status).toBe(401);
    expect(box.calls.context).toEqual([]);
  });

  it("does not call a tool when bootstrap is present and grant_id is missing", async () => {
    const box = world(grant());
    const result = await post(box, call("get_conversation_context", {}));
    expect(result.status).toBe(200);
    expect(JSON.stringify(result.body)).toContain("grant_rejected");
    expect(box.calls.context).toEqual([]);
    expect(box.calls.messages).toBe(0);
  });

  it("rejects a missing, expired, revoked, or mismatched grant", async () => {
    const missing = world(grant());
    const missingResult = await post(missing, call("get_conversation_context", { grant_id: "other" }));
    expect(JSON.stringify(missingResult.body)).toContain("grant_rejected");

    const expired = world(grant({ expiresAt: new Date(now.getTime() - 1000) }));
    expect(JSON.stringify((await post(expired, call("get_conversation_context", { grant_id: "grant-secret-value" }))).body)).toContain(
      "grant_rejected",
    );

    const revoked = world(grant({ revokedAt: now }));
    expect(JSON.stringify((await post(revoked, call("get_contact_profile", { grant_id: "grant-secret-value" }))).body)).toContain(
      "grant_rejected",
    );

    const foreign = world(
      grant({
        conversationId: "conversation-1",
        agentRun: { id: "run-1", agentKey: "intake", conversationId: "conversation-2" },
      }),
    );
    const foreignResult = await post(
      foreign,
      call("get_conversation_context", { grant_id: "grant-secret-value", conversationId: "conversation-9" }),
    );
    expect(JSON.stringify(foreignResult.body)).toContain("grant_rejected");
    expect(foreign.calls.context).toEqual([]);
  });

  it("rejects tools outside the allow-list, including send_client_message", async () => {
    const box = world(grant({ allowedToolsJson: ["get_conversation_context"] }));
    const blocked = await post(box, call("propose_reply", { grant_id: "grant-secret-value", body: "Черновик" }));
    expect(JSON.stringify(blocked.body)).toContain("tool_not_allowed");

    const send = await post(
      box,
      call("send_client_message", { grant_id: "grant-secret-value", body: "Привет" }),
    );
    expect(JSON.stringify(send.body)).toContain("tool_not_allowed");
    expect(box.calls.context).toEqual([]);
    expect(box.calls.messages).toBe(0);
    expect(JSON.stringify(box.output())).not.toContain("Привет");
  });

  it("reads only the grant conversation and stores a draft without sending", async () => {
    const lines: string[] = [];
    const box = world(grant());
    const context = await post(
      box,
      call("get_conversation_context", {
        grant_id: "grant-secret-value",
        conversationId: "conversation-9",
      }),
      { log: (line) => lines.push(line) },
    );
    expect(box.calls.context).toEqual(["conversation-1"]);
    expect(JSON.stringify(context.body)).toContain("Хочу поступить");
    expect((context.body as { result: { isError: boolean } }).result.isError).toBe(false);

    const draft = await post(
      box,
      call("propose_reply", { grant_id: "grant-secret-value", body: "  Здравствуйте  " }),
      { log: (line) => lines.push(line) },
    );
    expect(JSON.stringify(draft.body)).toContain("draft_stored");
    const stored = box.output() as { drafts: Array<{ body: string }>; hermesOutput?: string };
    expect(stored.drafts.map((item) => item.body)).toEqual(["старый", "Здравствуйте"]);
    expect(box.calls.messages).toBe(0);

    const logged = lines.join("\n");
    expect(logged).not.toContain("grant-secret-value");
    expect(logged).not.toContain(bootstrap);
    expect(logged).toContain(
      createHash("sha256").update("grant-secret-value").digest("hex").slice(0, 12),
    );
  });

  it("does not store a draft when policy denies it", async () => {
    const paused = world(grant(), { paused: true });
    const denied = await post(
      paused,
      call("get_conversation_context", { grant_id: "grant-secret-value" }),
    );
    expect(JSON.stringify(denied.body)).toContain("policy_denied");
    expect(paused.calls.context).toEqual([]);

    const unsafe = world(grant());
    const blocked = await post(
      unsafe,
      call("propose_reply", {
        grant_id: "grant-secret-value",
        body: "Мы гарантируем поступление в университет.",
      }),
    );
    expect(JSON.stringify(blocked.body)).toContain("policy_denied");
    expect(JSON.stringify(unsafe.output())).not.toContain("гарантируем");
    expect(unsafe.calls.messages).toBe(0);
  });
});
