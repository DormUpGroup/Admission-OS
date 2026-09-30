import type { DbClient } from "@/server/commands/outbox";
import { revokeCapabilityGrant, type ChatTurn } from "./capability-grant";

/** Inbound messages since the last reply, oldest first. One thought. */
export function unansweredClientThought(turns: ChatTurn[]): string {
  const parts: string[] = [];
  for (let i = turns.length - 1; i >= 0; i -= 1) {
    const turn = turns[i];
    if (turn?.direction !== "INBOUND") break;
    const body = turn.body?.trim();
    if (body) parts.unshift(body);
  }
  return parts.join("\n");
}

export function messageIdFromRunInput(inputJson: unknown): string | null {
  if (!inputJson || typeof inputJson !== "object" || Array.isArray(inputJson)) return null;
  const messageId = (inputJson as { messageId?: unknown }).messageId;
  return typeof messageId === "string" && messageId.trim() ? messageId : null;
}

/** True when the client already sent another message after this one. */
export async function hasLaterInboundMessage(
  db: Pick<DbClient, "conversationMessage">,
  input: { conversationId: string; messageId: string },
): Promise<boolean> {
  const current = await db.conversationMessage.findFirst({
    where: { id: input.messageId, conversationId: input.conversationId },
    select: { createdAt: true },
  });
  if (!current?.createdAt) return false;
  const later = await db.conversationMessage.findFirst({
    where: {
      conversationId: input.conversationId,
      direction: "INBOUND",
      id: { not: input.messageId },
      createdAt: { gt: current.createdAt },
    },
    select: { id: true },
  });
  return later != null;
}

/**
 * A newer client message arrived while a reply was being prepared.
 * Drop that reply so the new message can be answered from scratch.
 */
export async function dropInFlightIntakeReply(
  db: DbClient,
  input: { conversationId: string; messageId: string; now?: Date },
): Promise<number> {
  const now = input.now ?? new Date();
  const open = await db.agentRun.findMany({
    where: {
      conversationId: input.conversationId,
      agentKey: "intake",
      status: { in: ["QUEUED", "RUNNING"] },
    },
    select: { id: true, inputJson: true },
  });
  let dropped = 0;
  for (const run of open) {
    if (messageIdFromRunInput(run.inputJson) === input.messageId) continue;
    const updated = await db.agentRun.updateMany({
      where: { id: run.id, status: { in: ["QUEUED", "RUNNING"] } },
      data: {
        status: "COMPLETED",
        errorCode: "later_client_message",
        errorMessage: "A newer client message is answered instead",
        completedAt: now,
      },
    });
    if (updated.count === 0) continue;
    await revokeCapabilityGrant(db, run.id, now);
    dropped += updated.count;
  }
  return dropped;
}
