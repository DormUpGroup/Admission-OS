import type { OutboxEvent } from "@prisma/client";
import type { DbClient } from "@/server/commands/outbox";
import { AGENT_DEFINITIONS_BY_KEY, syncAgentDefinitions } from "./registry";

function asRecord(payload: unknown): Record<string, unknown> | null {
  return payload && typeof payload === "object" && !Array.isArray(payload)
    ? (payload as Record<string, unknown>)
    : null;
}

function isTelegramBotCommand(body: string | null): boolean {
  return /^\s*\/(?:start|help)(?:\s|$)/iu.test(body ?? "");
}

export type QueueIntakeRunResult =
  | { queued: true; agentRunId: string; duplicate: boolean }
  | { queued: false; reason: string };

/**
 * Persist an Intake run after inbound data is durable. This intentionally does
 * not contact Hermes; it provides the idempotent hand-off point for PR1.
 */
export async function queueIntakeRunForMessageReceived(
  db: DbClient,
  event: Pick<OutboxEvent, "aggregateId" | "eventType" | "idempotencyKey" | "payloadJson">,
): Promise<QueueIntakeRunResult> {
  if (event.eventType !== "message.received") {
    return { queued: false, reason: "unsupported_event" };
  }
  const payload = asRecord(event.payloadJson);
  const conversationId = typeof payload?.conversationId === "string" ? payload.conversationId : null;
  const messageId = typeof payload?.messageId === "string" ? payload.messageId : null;
  if (!conversationId || !messageId) {
    return { queued: false, reason: "invalid_payload" };
  }

  const conversation = await db.conversation.findUnique({
    where: { id: conversationId },
    select: {
      id: true,
      leadId: true,
      studentId: true,
      automationPausedAt: true,
      messages: { where: { id: messageId }, select: { body: true }, take: 1 },
    },
  });
  if (!conversation) return { queued: false, reason: "conversation_not_found" };
  if (conversation.automationPausedAt) return { queued: false, reason: "automation_paused" };
  if (!conversation.leadId || conversation.studentId) {
    return { queued: false, reason: "not_lead_conversation" };
  }
  if (isTelegramBotCommand(conversation.messages[0]?.body ?? null)) {
    return { queued: false, reason: "bot_command" };
  }

  await syncAgentDefinitions(db);
  const definition = AGENT_DEFINITIONS_BY_KEY.get("intake");
  if (!definition) throw new Error("Intake agent definition is missing");

  const idempotencyKey = `agent:intake:${event.idempotencyKey}`;
  const existing = await db.agentRun.findUnique({ where: { idempotencyKey } });
  if (existing) {
    return { queued: true, agentRunId: existing.id, duplicate: true };
  }

  try {
    const run = await db.agentRun.create({
      data: {
        agentKey: "intake",
        conversationId,
        subjectType: "ConversationMessage",
        subjectId: event.aggregateId || messageId,
        status: "QUEUED",
        inputJson: {
          eventType: event.eventType,
          outboxIdempotencyKey: event.idempotencyKey,
          messageId,
          conversationId,
        },
        idempotencyKey,
        correlationId: event.idempotencyKey,
        queuedAt: new Date(),
        promptVersion: definition.promptVersion,
        policyVersion: definition.policyVersion,
      },
    });
    return { queued: true, agentRunId: run.id, duplicate: false };
  } catch (error) {
    // A recovered lease can overlap a slow worker. The unique idempotency key
    // is the final fence against duplicate AgentRuns.
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      (error as { code?: string }).code === "P2002"
    ) {
      const winner = await db.agentRun.findUnique({ where: { idempotencyKey } });
      if (winner) return { queued: true, agentRunId: winner.id, duplicate: true };
    }
    throw error;
  }
}
