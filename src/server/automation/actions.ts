import type { Prisma } from "@prisma/client";
import { createApprovalRequest } from "./approval";
import { updateLeadQualification } from "./context";
import {
  evaluateActionPolicyForConversation,
  POLICY_DECISIONS,
  type PolicyEvaluation,
} from "./policy";
import { requestTelegramSend } from "@/server/commands/telegram-outbound";
import { prisma } from "@/lib/db";

type AgentActionResult<T> =
  | { status: "ALLOWED"; result: T; policy: PolicyEvaluation }
  | { status: "APPROVAL_REQUIRED"; approvalId: string; payloadHash: string; policy: PolicyEvaluation }
  | { status: "DENIED"; policy: PolicyEvaluation };

async function approvalForAction(input: {
  agentRunId?: string | null;
  actionKey: string;
  payload: Prisma.InputJsonValue;
  requestedById?: string | null;
  riskClass?: string;
}) {
  const approval = await createApprovalRequest({
    agentRunId: input.agentRunId,
    actionKey: input.actionKey,
    payload: input.payload,
    requestedByType: "AGENT",
    requestedById: input.requestedById,
    riskClass: input.riskClass,
  });
  return { approvalId: approval.id, payloadHash: approval.payloadHash };
}

/** Agent-only gateway. Human staff replies keep using requestTelegramSend directly. */
export async function sendAgentClientMessage(input: {
  agentRunId?: string | null;
  conversationId: string;
  body: string;
  clientRequestId: string;
}) : Promise<AgentActionResult<{ messageId: string; duplicate: boolean }>> {
  const policy = await evaluateActionPolicyForConversation(prisma, {
    agentKey: "intake",
    toolName: "send_client_message",
    conversationId: input.conversationId,
    body: input.body,
  });
  if (policy.decision === POLICY_DECISIONS.DENY) return { status: "DENIED", policy };
  if (policy.decision === POLICY_DECISIONS.REQUIRE_APPROVAL) {
    const approval = await approvalForAction({
      agentRunId: input.agentRunId,
      actionKey: "send_client_message",
      payload: {
        conversationId: input.conversationId,
        body: input.body.trim(),
        clientRequestId: input.clientRequestId,
      },
    });
    return { status: "APPROVAL_REQUIRED", policy, ...approval };
  }

  const sent = await requestTelegramSend({
    conversationId: input.conversationId,
    body: input.body,
    clientRequestId: input.clientRequestId,
  });
  return {
    status: "ALLOWED",
    policy,
    result: { messageId: sent.message.id, duplicate: sent.duplicate },
  };
}

export async function updateLeadQualificationFromAgent(input: {
  conversationId: string;
  patch: Parameters<typeof updateLeadQualification>[0]["patch"];
}): Promise<AgentActionResult<{ leadId: string }>> {
  const policy = await evaluateActionPolicyForConversation(prisma, {
    agentKey: "intake",
    toolName: "update_lead_qualification",
    conversationId: input.conversationId,
  });
  if (policy.decision === POLICY_DECISIONS.DENY) return { status: "DENIED", policy };
  const lead = await updateLeadQualification(input);
  return { status: "ALLOWED", policy, result: { leadId: lead.id } };
}

/**
 * Escalation is deliberately not coupled to an outbound acknowledgement. A
 * client message might be denied while staff still must see the case and the
 * automation must stop.
 */
export async function escalateAgentToHuman(input: {
  conversationId: string;
  reason: string;
}): Promise<AgentActionResult<{ conversationId: string; notifiedCurator: boolean }>> {
  const policy = await evaluateActionPolicyForConversation(prisma, {
    agentKey: "intake",
    toolName: "escalate_to_human",
    conversationId: input.conversationId,
  });
  if (policy.decision === POLICY_DECISIONS.DENY) return { status: "DENIED", policy };

  const result = await prisma.$transaction(async (tx) => {
    const conversation = await tx.conversation.findUnique({
      where: { id: input.conversationId },
      include: {
        lead: { select: { assignedCuratorId: true } },
        student: { select: { curatorId: true, id: true } },
      },
    });
    if (!conversation) throw new Error("Conversation not found");
    const reason = input.reason.trim() || "Agent requested human review";
    await tx.conversation.update({
      where: { id: conversation.id },
      data: { automationPausedAt: new Date(), automationPauseReason: reason },
    });
    const curatorId =
      conversation.assignedCuratorId ??
      conversation.lead?.assignedCuratorId ??
      conversation.student?.curatorId ??
      null;
    if (!curatorId) return { notifiedCurator: false };
    await tx.inAppNotification.create({
      data: {
        userId: curatorId,
        studentId: conversation.student?.id ?? null,
        type: "automation.escalated",
        title: "Нужна проверка куратора",
        body: reason,
        metadataJson: JSON.stringify({ conversationId: conversation.id, source: "intake" }),
      },
    });
    return { notifiedCurator: true };
  });
  return {
    status: "ALLOWED",
    policy,
    result: { conversationId: input.conversationId, ...result },
  };
}

/**
 * Scheduling cannot create an appointment in PR0. It records the exact future
 * action for a human to review, so no proposal message or calendar write leaks
 * through before approval.
 */
export async function requestSchedulingApproval(input: {
  agentRunId?: string | null;
  conversationId: string;
  actionKey:
    | "create_appointment_draft"
    | "confirm_appointment"
    | "reschedule_appointment"
    | "cancel_appointment";
  payload: Prisma.InputJsonValue;
}) : Promise<AgentActionResult<never>> {
  const policy = await evaluateActionPolicyForConversation(prisma, {
    agentKey: "scheduling",
    toolName: input.actionKey,
    conversationId: input.conversationId,
  });
  if (policy.decision === POLICY_DECISIONS.DENY) return { status: "DENIED", policy };
  const approval = await approvalForAction({
    agentRunId: input.agentRunId,
    actionKey: input.actionKey,
    payload: { conversationId: input.conversationId, action: input.payload },
    riskClass: "HIGH",
  });
  return { status: "APPROVAL_REQUIRED", policy, ...approval };
}
