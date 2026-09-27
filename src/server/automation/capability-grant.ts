import { createHash, randomBytes } from "crypto";
import type { Prisma } from "@prisma/client";
import type { DbClient } from "@/server/commands/outbox";

/** Tools Hermes may call in this PR. Not copied from the intake registry. */
export const MCP_V1_TOOLS = [
  "get_conversation_context",
  "get_contact_profile",
  "propose_reply",
] as const;

export type McpV1Tool = (typeof MCP_V1_TOOLS)[number];

export const CAPABILITY_GRANT_TTL_MS = 15 * 60 * 1000;

export function isMcpV1Tool(name: string): name is McpV1Tool {
  return (MCP_V1_TOOLS as readonly string[]).includes(name);
}

export function newCapabilityGrantId(): string {
  return randomBytes(32).toString("base64url");
}

/** Log prefix only. Never log the raw grant id. */
export function capabilityGrantLogHash(grantId: string): string {
  return createHash("sha256").update(grantId).digest("hex").slice(0, 12);
}

export function hermesRunInstructions(grantId: string): string {
  return [
    "You are the Immigrome intake assistant.",
    "Call tools only through the admission_os MCP server.",
    `Pass grant_id exactly as ${grantId} on every tool call.`,
    "Allowed tools: get_conversation_context, get_contact_profile, propose_reply.",
    "Read the conversation and the contact, then call propose_reply with the draft text.",
    "Do not send a message to the client. Do not use Telegram.",
    "Write the draft in the client's language, usually Russian.",
    "Sound like a person in a Telegram chat: short, warm, plain words.",
    "Write in sentences. Use a bullet list only when the content is a list of requirements or a set of items that is clearer as a list.",
    "No corporate greeting, no \"уважаемый клиент\", no essay.",
    "Do not promise admission, a visa, or a payment.",
  ].join("\n");
}

function isUniqueConstraint(error: unknown): boolean {
  return Boolean(
    error &&
      typeof error === "object" &&
      "code" in error &&
      (error as { code?: string }).code === "P2002",
  );
}

export type CapabilityGrantRow = {
  id: string;
  agentRunId: string;
  conversationId: string;
  allowedToolsJson: Prisma.JsonValue;
  expiresAt: Date;
  revokedAt: Date | null;
};

/**
 * One grant per AgentRun. Retries keep the same id so the Hermes idempotency
 * body stays identical, and only push expiresAt forward.
 */
export async function ensureCapabilityGrant(
  db: DbClient,
  input: { agentRunId: string; conversationId: string; now?: Date },
): Promise<CapabilityGrantRow> {
  const now = input.now ?? new Date();
  const expiresAt = new Date(now.getTime() + CAPABILITY_GRANT_TTL_MS);
  const existing = await db.agentCapabilityGrant.findUnique({
    where: { agentRunId: input.agentRunId },
  });
  if (existing) {
    if (existing.revokedAt) return existing;
    if (existing.expiresAt.getTime() >= expiresAt.getTime()) return existing;
    return db.agentCapabilityGrant.update({
      where: { agentRunId: input.agentRunId },
      data: { expiresAt },
    });
  }

  try {
    return await db.agentCapabilityGrant.create({
      data: {
        id: newCapabilityGrantId(),
        agentRunId: input.agentRunId,
        conversationId: input.conversationId,
        allowedToolsJson: [...MCP_V1_TOOLS],
        expiresAt,
      },
    });
  } catch (error) {
    if (!isUniqueConstraint(error)) throw error;
    const raced = await db.agentCapabilityGrant.findUnique({
      where: { agentRunId: input.agentRunId },
    });
    if (!raced) throw error;
    return raced;
  }
}

export async function revokeCapabilityGrant(
  db: DbClient,
  agentRunId: string,
  now: Date = new Date(),
): Promise<void> {
  await db.agentCapabilityGrant.updateMany({
    where: { agentRunId, revokedAt: null },
    data: { revokedAt: now },
  });
}
