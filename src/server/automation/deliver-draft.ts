import { createHash } from "crypto";
import type { Prisma } from "@prisma/client";
import type { DbClient } from "@/server/commands/outbox";
import { tryDeliverTelegramSendNow } from "@/server/delivery/telegram-inline";
import { sendAgentClientMessage } from "./actions";
import {
  evaluateActionPolicyForConversation,
  POLICY_DECISIONS,
  type PolicyEvaluation,
} from "./policy";

export function agentSendClientRequestId(agentRunId: string, body: string): string {
  const hash = createHash("sha256").update(body).digest("hex").slice(0, 16);
  return `agent-send:${agentRunId}:${hash}`;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/** Newest propose_reply text. A discarded draft means the curator rejected it. */
export function readDraftBody(outputJson: unknown): string | null {
  const drafts = asRecord(outputJson)?.drafts;
  if (!Array.isArray(drafts)) return null;
  for (let i = drafts.length - 1; i >= 0; i--) {
    const item = asRecord(drafts[i]);
    if (!item) continue;
    const body = typeof item.body === "string" ? item.body.trim() : "";
    if (!body) continue;
    if (item.discarded === true) return null;
    return body;
  }
  return null;
}

export type DraftDelivery = { status: "sent" | "skipped" | "held"; reason?: string };

type DraftDeliveryDeps = {
  evaluate?: typeof evaluateActionPolicyForConversation;
  send?: typeof sendAgentClientMessage;
  deliverNow?: typeof tryDeliverTelegramSendNow;
};

/**
 * Hermes often stops after propose_reply. When the turn ends with that draft
 * and nothing was already sent, deliver it. Policy holds (paused, opt-out,
 * sensitive text) stay in the curator composer.
 */
export async function sendUnsentRunDraft(
  db: DbClient,
  input: {
    agentRunId: string;
    conversationId: string;
    outputJson: Prisma.JsonValue | null;
    startedAt: Date | null;
  },
  deps: DraftDeliveryDeps = {},
): Promise<DraftDelivery> {
  const body = readDraftBody(input.outputJson);
  if (!body) return { status: "skipped", reason: "no_draft" };

  if (input.startedAt) {
    const outbound = await db.conversationMessage.findFirst({
      where: {
        conversationId: input.conversationId,
        direction: "OUTBOUND",
        createdAt: { gte: input.startedAt },
      },
      select: { id: true },
    });
    if (outbound) return { status: "skipped", reason: "already_outbound" };
  }

  const evaluate = deps.evaluate ?? evaluateActionPolicyForConversation;
  const policy = await evaluate(db, {
    agentKey: "intake",
    toolName: "send_client_message",
    conversationId: input.conversationId,
    body,
  });
  if (policy.decision !== POLICY_DECISIONS.ALLOW) {
    return { status: "held", reason: policy.reasons.join(",") || policy.decision };
  }

  const send = deps.send ?? sendAgentClientMessage;
  const sent = await send({
    agentRunId: input.agentRunId,
    conversationId: input.conversationId,
    body,
    clientRequestId: agentSendClientRequestId(input.agentRunId, body),
  });
  if (sent.status !== "ALLOWED") {
    return heldFromSend(sent.policy);
  }

  const deliverNow = deps.deliverNow ?? tryDeliverTelegramSendNow;
  await deliverNow(sent.result.messageId);
  return { status: "sent" };
}

function heldFromSend(policy: PolicyEvaluation): DraftDelivery {
  return { status: "held", reason: policy.reasons.join(",") || policy.decision };
}
