import { timingSafeEqual } from "crypto";
import type { Prisma } from "@prisma/client";
import type { DbClient } from "@/server/commands/outbox";
import {
  capabilityGrantLogHash,
  isMcpV1Tool,
  MCP_V1_TOOLS,
  type McpV1Tool,
} from "./capability-grant";
import { getContactProfile, getConversationContext } from "./context";
import {
  evaluateActionPolicyForConversation,
  POLICY_DECISIONS,
} from "./policy";
import type { AgentKey } from "./registry";

const JSON_RPC = "2.0";

const BOOTSTRAP_METHODS = new Set([
  "initialize",
  "tools/list",
  "ping",
  "notifications/initialized",
]);

export type McpToolExecutors = {
  getConversationContext: (conversationId: string) => Promise<unknown>;
  getContactProfile: (conversationId: string) => Promise<unknown>;
  saveDraft: (input: { agentRunId: string; body: string }) => Promise<void>;
};

export function defaultMcpToolExecutors(db: DbClient): McpToolExecutors {
  return {
    getConversationContext: (conversationId) => getConversationContext(conversationId),
    getContactProfile: (conversationId) => getContactProfile(conversationId),
    saveDraft: (input) => saveProposeReplyDraft(db, input),
  };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

export async function saveProposeReplyDraft(
  db: DbClient,
  input: { agentRunId: string; body: string; now?: Date },
): Promise<void> {
  const run = await db.agentRun.findUnique({
    where: { id: input.agentRunId },
    select: { outputJson: true },
  });
  const existing = asRecord(run?.outputJson) ?? {};
  const prior = Array.isArray(existing.drafts) ? existing.drafts : [];
  const drafts = [
    ...prior,
    { body: input.body, createdAt: (input.now ?? new Date()).toISOString() },
  ];
  await db.agentRun.update({
    where: { id: input.agentRunId },
    data: { outputJson: { ...existing, drafts } as Prisma.InputJsonValue },
  });
}

function bearerToken(authorizationHeader: string | null): string | null {
  if (!authorizationHeader) return null;
  const match = /^Bearer\s+(\S+)\s*$/i.exec(authorizationHeader.trim());
  return match?.[1] ?? null;
}

function bootstrapMatches(provided: string, expected: string): boolean {
  const left = Buffer.from(provided);
  const right = Buffer.from(expected);
  if (left.length !== right.length) {
    timingSafeEqual(left, left);
    return false;
  }
  return timingSafeEqual(left, right);
}

function rpcResult(id: unknown, result: unknown) {
  return { jsonrpc: JSON_RPC, id: id ?? null, result };
}

function rpcError(id: unknown, code: number, message: string) {
  return { jsonrpc: JSON_RPC, id: id ?? null, error: { code, message } };
}

function toolResult(id: unknown, text: string, isError: boolean) {
  return rpcResult(id, {
    content: [{ type: "text", text }],
    isError,
  });
}

function toolSchema(name: McpV1Tool) {
  const properties: Record<string, unknown> = {
    grant_id: { type: "string", description: "Capability grant id for this run." },
  };
  const required = ["grant_id"];
  if (name === "propose_reply") {
    properties.body = { type: "string", description: "Draft reply. This does not send it." };
    required.push("body");
  }
  return {
    name,
    description:
      name === "propose_reply"
        ? "Store a draft reply for staff. Does not message the client."
        : name === "get_contact_profile"
          ? "Read the lead or student linked to this conversation."
          : "Read recent messages and automation state for this conversation.",
    inputSchema: {
      type: "object",
      properties,
      required,
      additionalProperties: false,
    },
  };
}

function asAgentKey(value: string): AgentKey | null {
  if (value === "intake" || value === "scheduling" || value === "qa_safety") return value;
  return null;
}

function allowedTools(value: Prisma.JsonValue): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string");
}

export type McpHttpResult = {
  status: number;
  body: unknown | null;
};

export async function handleMcpPost(options: {
  db: DbClient;
  authorizationHeader: string | null;
  body: unknown;
  env?: NodeJS.ProcessEnv | Record<string, string | undefined>;
  now?: Date;
  executors?: McpToolExecutors;
  log?: (line: string) => void;
}): Promise<McpHttpResult> {
  const env = options.env ?? process.env;
  const expected = env.MCP_BOOTSTRAP_KEY?.trim() ?? "";
  const presented = bearerToken(options.authorizationHeader);
  if (!expected || !presented || !bootstrapMatches(presented, expected)) {
    return { status: 401, body: { error: "unauthorized" } };
  }

  const message = asRecord(options.body);
  if (!message || message.jsonrpc !== JSON_RPC || typeof message.method !== "string") {
    return { status: 400, body: rpcError(null, -32600, "invalid_request") };
  }

  const method = message.method;
  const id = message.id ?? null;
  if (method === "notifications/initialized") {
    return { status: 202, body: null };
  }

  if (!BOOTSTRAP_METHODS.has(method) && method !== "tools/call") {
    return { status: 200, body: rpcError(id, -32601, "method_not_found") };
  }

  if (method === "ping") {
    return { status: 200, body: rpcResult(id, {}) };
  }

  if (method === "initialize") {
    const params = asRecord(message.params);
    const requested =
      typeof params?.protocolVersion === "string" && params.protocolVersion.trim()
        ? params.protocolVersion.trim()
        : "2024-11-05";
    return {
      status: 200,
      body: rpcResult(id, {
        protocolVersion: requested,
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: "admission-os", version: "1" },
      }),
    };
  }

  if (method === "tools/list") {
    return {
      status: 200,
      body: rpcResult(id, { tools: MCP_V1_TOOLS.map((name) => toolSchema(name)) }),
    };
  }

  return callTool(options, id, message.params);
}

async function callTool(
  options: {
    db: DbClient;
    now?: Date;
    executors?: McpToolExecutors;
    log?: (line: string) => void;
  },
  id: unknown,
  paramsValue: unknown,
): Promise<McpHttpResult> {
  const now = options.now ?? new Date();
  const executors = options.executors ?? defaultMcpToolExecutors(options.db);
  const log = options.log ?? ((line: string) => console.log(line));
  const params = asRecord(paramsValue);
  const toolName = typeof params?.name === "string" ? params.name : "";
  const args = asRecord(params?.arguments) ?? {};
  const grantId = typeof args.grant_id === "string" ? args.grant_id.trim() : "";

  const logLine = (result: string) => {
    log(
      JSON.stringify({
        level: "info",
        msg: "mcp.tools.call",
        tool: toolName || null,
        grantHash: grantId ? capabilityGrantLogHash(grantId) : null,
        result,
      }),
    );
  };

  if (!grantId || !isMcpV1Tool(toolName)) {
    logLine(grantId && toolName ? "tool_not_allowed" : "grant_rejected");
    return {
      status: 200,
      body: toolResult(id, grantId && toolName ? "tool_not_allowed" : "grant_rejected", true),
    };
  }

  const grant = await options.db.agentCapabilityGrant.findUnique({
    where: { id: grantId },
    include: { agentRun: { select: { id: true, agentKey: true, conversationId: true } } },
  });
  const run = grant?.agentRun;
  const grantOk =
    grant &&
    !grant.revokedAt &&
    grant.expiresAt.getTime() > now.getTime() &&
    run &&
    run.id === grant.agentRunId &&
    run.conversationId === grant.conversationId &&
    allowedTools(grant.allowedToolsJson).includes(toolName);

  if (!grant || !run || grant.revokedAt || grant.expiresAt.getTime() <= now.getTime()) {
    logLine("grant_rejected");
    return { status: 200, body: toolResult(id, "grant_rejected", true) };
  }
  if (run.conversationId !== grant.conversationId || run.id !== grant.agentRunId) {
    logLine("grant_rejected");
    return { status: 200, body: toolResult(id, "grant_rejected", true) };
  }
  if (!grantOk) {
    logLine("tool_not_allowed");
    return { status: 200, body: toolResult(id, "tool_not_allowed", true) };
  }

  const agentKey = asAgentKey(run.agentKey);
  if (!agentKey) {
    logLine("policy_denied");
    return { status: 200, body: toolResult(id, "policy_denied", true) };
  }

  const draftBody = typeof args.body === "string" ? args.body : null;
  const policy = await evaluateActionPolicyForConversation(options.db, {
    agentKey,
    toolName,
    conversationId: grant.conversationId,
    body: toolName === "propose_reply" ? draftBody : undefined,
  });
  if (policy.decision !== POLICY_DECISIONS.ALLOW) {
    logLine("policy_denied");
    return {
      status: 200,
      body: toolResult(id, `policy_denied:${policy.reasons.join(",")}`, true),
    };
  }

  if (toolName === "propose_reply") {
    const body = draftBody?.trim() ?? "";
    if (!body) {
      logLine("empty_draft");
      return { status: 200, body: toolResult(id, "empty_draft", true) };
    }
    await executors.saveDraft({ agentRunId: grant.agentRunId, body });
    logLine("ok");
    return { status: 200, body: toolResult(id, "draft_stored", false) };
  }

  const payload =
    toolName === "get_contact_profile"
      ? await executors.getContactProfile(grant.conversationId)
      : await executors.getConversationContext(grant.conversationId);
  logLine("ok");
  return { status: 200, body: toolResult(id, JSON.stringify(payload), false) };
}
