import { timingSafeEqual } from "crypto";
import type { Prisma } from "@prisma/client";
import type { DbClient } from "@/server/commands/outbox";
import {
  escalateAgentToHuman,
  sendAgentClientMessage,
  updateLeadQualificationFromAgent,
} from "./actions";
import {
  bookingLinkReplacesReply,
  loadBookingConsentTurn,
  loadConsultationDecision,
  shouldSendBookingLink,
} from "@/server/booking/consent";
import { sendBookingLinkForConversation } from "@/server/booking/send-link";
import { tryDeliverTelegramSendNow } from "@/server/delivery/telegram-inline";
import { agentSendClientRequestId } from "./deliver-draft";
import {
  capabilityGrantLogHash,
  isMcpV1Tool,
  LEAD_FACT_FIELDS,
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

type QualificationPatch = Parameters<typeof updateLeadQualificationFromAgent>[0]["patch"];

export type McpToolExecutors = {
  getConversationContext: (conversationId: string) => Promise<unknown>;
  getContactProfile: (conversationId: string) => Promise<unknown>;
  saveDraft: (input: { agentRunId: string; body: string }) => Promise<void>;
  sendClientMessage: (input: {
    agentRunId: string;
    conversationId: string;
    body: string;
  }) => ReturnType<typeof sendAgentClientMessage>;
  updateQualification: (input: {
    conversationId: string;
    patch: QualificationPatch;
  }) => ReturnType<typeof updateLeadQualificationFromAgent>;
  escalate: (input: {
    conversationId: string;
    reason: string;
  }) => ReturnType<typeof escalateAgentToHuman>;
  sendBookingLink: (input: {
    agentRunId: string;
    conversationId: string;
  }) => Promise<string>;
  readBookingTurn?: (conversationId: string) => ReturnType<typeof loadBookingConsentTurn>;
  readBookingDecision?: (conversationId: string) => ReturnType<typeof loadConsultationDecision>;
};

export function defaultMcpToolExecutors(db: DbClient): McpToolExecutors {
  return {
    getConversationContext: (conversationId) => getConversationContext(conversationId),
    getContactProfile: (conversationId) => getContactProfile(conversationId),
    saveDraft: (input) => saveProposeReplyDraft(db, input),
    sendClientMessage: async (input) => {
      const sent = await sendAgentClientMessage({
        agentRunId: input.agentRunId,
        conversationId: input.conversationId,
        body: input.body,
        clientRequestId: agentSendClientRequestId(input.agentRunId, input.body),
      });
      if (sent.status === "ALLOWED") {
        await tryDeliverTelegramSendNow(sent.result.messageId).catch(() => undefined);
      }
      return sent;
    },
    updateQualification: (input) => updateLeadQualificationFromAgent(input),
    escalate: (input) => escalateAgentToHuman(input),
    sendBookingLink: (input) =>
      sendBookingLinkForConversation({
        agentRunId: input.agentRunId,
        conversationId: input.conversationId,
      }),
    readBookingTurn: (conversationId) => loadBookingConsentTurn(conversationId),
    readBookingDecision: (conversationId) => loadConsultationDecision(conversationId),
  };
}

/** The booking page replaces a freeform reply when a consultation is already agreed. */
async function bookingLinkInsteadOfReply(
  executors: McpToolExecutors,
  input: { agentRunId: string; conversationId: string },
): Promise<string | null> {
  if (executors.readBookingDecision) {
    const decision = await executors.readBookingDecision(input.conversationId);
    if (!decision.agreedNow && !decision.sendBecauseAlreadyAgreed) return null;
    const text = await executors.sendBookingLink(input);
    if (decision.agreedNow && bookingLinkReplacesReply(text)) return text;
    if (decision.sendBecauseAlreadyAgreed && (text === "sent" || text.startsWith("already_booked"))) {
      return text;
    }
    return null;
  }
  if (!executors.readBookingTurn) return null;
  const turn = await executors.readBookingTurn(input.conversationId);
  if (!shouldSendBookingLink(turn)) return null;
  const text = await executors.sendBookingLink(input);
  return bookingLinkReplacesReply(text) ? text : null;
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
  let description = "Read recent messages and automation state for this conversation.";
  if (name === "get_contact_profile") {
    description =
      "Read the lead card. Facts the client already said are filled in. Do not ask those again.";
  } else if (name === "propose_reply") {
    description =
      "Write the one reply to the client. The server sends this text when the turn ends.";
    properties.body = {
      type: "string",
      description: "Full reply the client should receive. Call this once.",
    };
    required.push("body");
  } else if (name === "send_client_message") {
    description = "Send one Telegram reply to the client.";
    properties.body = { type: "string", description: "Message text to send." };
    required.push("body");
  } else if (name === "send_booking_link") {
    description =
      "Send the client a website link to book a consultation. Do not invent the URL or offer times in chat.";
  } else if (name === "escalate_to_human") {
    description = "Pause automation on this chat and notify the curator.";
    properties.reason = {
      type: "string",
      description:
        "The problem, then the one action the curator must take. Example: Клиент спрашивает стоимость программы. Напишите цену в этот чат.",
    };
    required.push("reason");
  } else if (name === "update_lead_qualification") {
    description = "Save a fact the client just stated.";
    properties.firstName = { type: "string" };
    properties.lastName = { type: "string" };
    properties.locale = { type: "string" };
    for (const field of LEAD_FACT_FIELDS) {
      properties[field] = { type: "string" };
    }
  }
  return {
    name,
    description,
    inputSchema: {
      type: "object",
      properties,
      required,
      additionalProperties: false,
    },
  };
}

function trimmed(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const text = value.trim();
  return text ? text : undefined;
}

function qualificationPatch(args: Record<string, unknown>): QualificationPatch {
  const qualification: Record<string, Prisma.JsonValue> = {};
  for (const field of LEAD_FACT_FIELDS) {
    const value = trimmed(args[field]);
    if (value) qualification[field] = value;
  }
  return {
    firstName: trimmed(args.firstName),
    lastName: trimmed(args.lastName),
    locale: trimmed(args.locale),
    qualification: Object.keys(qualification).length > 0 ? qualification : undefined,
  };
}

function patchIsEmpty(patch: QualificationPatch): boolean {
  return !patch.firstName && !patch.lastName && !patch.locale && !patch.qualification;
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
    body:
      toolName === "propose_reply" || toolName === "send_client_message" ? draftBody : undefined,
  });
  if (policy.decision === POLICY_DECISIONS.DENY) {
    logLine("policy_denied");
    return {
      status: 200,
      body: toolResult(id, `policy_denied:${policy.reasons.join(",")}`, true),
    };
  }
  if (policy.decision !== POLICY_DECISIONS.ALLOW && toolName !== "send_client_message") {
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
    const booked = await bookingLinkInsteadOfReply(executors, {
      agentRunId: grant.agentRunId,
      conversationId: grant.conversationId,
    });
    if (booked) {
      logLine("booking_link");
      return { status: 200, body: toolResult(id, booked, false) };
    }
    await executors.saveDraft({ agentRunId: grant.agentRunId, body });
    const sent = await executors.sendClientMessage({
      agentRunId: grant.agentRunId,
      conversationId: grant.conversationId,
      body,
    });
    if (sent.status === "DENIED") {
      logLine("policy_denied");
      return {
        status: 200,
        body: toolResult(id, `policy_denied:${sent.policy.reasons.join(",")}`, true),
      };
    }
    if (sent.status === "APPROVAL_REQUIRED") {
      logLine("approval_required");
      return {
        status: 200,
        body: toolResult(id, `approval_required:${sent.policy.reasons.join(",")}`, false),
      };
    }
    logLine("ok");
    return {
      status: 200,
      body: toolResult(id, sent.result.duplicate ? "already_sent" : "sent", false),
    };
  }

  if (toolName === "send_client_message") {
    const body = draftBody?.trim() ?? "";
    if (!body) {
      logLine("empty_message");
      return { status: 200, body: toolResult(id, "empty_message", true) };
    }
    const booked = await bookingLinkInsteadOfReply(executors, {
      agentRunId: grant.agentRunId,
      conversationId: grant.conversationId,
    });
    if (booked) {
      logLine("booking_link");
      return { status: 200, body: toolResult(id, booked, false) };
    }
    const sent = await executors.sendClientMessage({
      agentRunId: grant.agentRunId,
      conversationId: grant.conversationId,
      body,
    });
    if (sent.status === "DENIED") {
      logLine("policy_denied");
      return {
        status: 200,
        body: toolResult(id, `policy_denied:${sent.policy.reasons.join(",")}`, true),
      };
    }
    if (sent.status === "APPROVAL_REQUIRED") {
      logLine("approval_required");
      return {
        status: 200,
        body: toolResult(id, `approval_required:${sent.policy.reasons.join(",")}`, false),
      };
    }
    logLine("ok");
    return {
      status: 200,
      body: toolResult(id, sent.result.duplicate ? "already_sent" : "sent", false),
    };
  }

  if (toolName === "update_lead_qualification") {
    const patch = qualificationPatch(args);
    if (patchIsEmpty(patch)) {
      logLine("nothing_to_save");
      return { status: 200, body: toolResult(id, "nothing_to_save", true) };
    }
    const saved = await executors.updateQualification({
      conversationId: grant.conversationId,
      patch,
    });
    if (saved.status !== "ALLOWED") {
      logLine("policy_denied");
      return {
        status: 200,
        body: toolResult(id, `policy_denied:${saved.policy.reasons.join(",")}`, true),
      };
    }
    logLine("ok");
    return { status: 200, body: toolResult(id, "qualification_saved", false) };
  }

  if (toolName === "send_booking_link") {
    const text = await executors.sendBookingLink({
      agentRunId: grant.agentRunId,
      conversationId: grant.conversationId,
    });
    const failed = text === "no_curator" || text.startsWith("booking_unavailable");
    logLine(failed ? "booking_unavailable" : "ok");
    return { status: 200, body: toolResult(id, text, failed) };
  }

  if (toolName === "escalate_to_human") {
    const reason = trimmed(args.reason)?.slice(0, 500) ?? "";
    if (!reason) {
      logLine("empty_reason");
      return { status: 200, body: toolResult(id, "empty_reason", true) };
    }
    const escalated = await executors.escalate({
      conversationId: grant.conversationId,
      reason,
    });
    if (escalated.status !== "ALLOWED") {
      logLine("policy_denied");
      return {
        status: 200,
        body: toolResult(id, `policy_denied:${escalated.policy.reasons.join(",")}`, true),
      };
    }
    logLine("ok");
    return { status: 200, body: toolResult(id, "escalated", false) };
  }

  const payload =
    toolName === "get_contact_profile"
      ? await executors.getContactProfile(grant.conversationId)
      : await executors.getConversationContext(grant.conversationId);
  logLine("ok");
  return { status: 200, body: toolResult(id, JSON.stringify(payload), false) };
}
