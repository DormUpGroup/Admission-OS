import type { DbClient } from "@/server/commands/outbox";
import type { AgentKey } from "./registry";

export const POLICY_DECISIONS = {
  ALLOW: "ALLOW",
  REQUIRE_APPROVAL: "REQUIRE_APPROVAL",
  DENY: "DENY",
} as const;

export type PolicyDecision = (typeof POLICY_DECISIONS)[keyof typeof POLICY_DECISIONS];

export type PolicyEvaluation = {
  decision: PolicyDecision;
  reasons: string[];
};

export type PolicyConversationContext = {
  channel: string;
  automationPausedAt: Date | null;
  hasLinkedChannelIdentity: boolean;
  consentStatus: string | null;
};

export type EvaluateActionPolicyInput = {
  agentKey: AgentKey;
  toolName: string;
  body?: string | null;
  conversation: PolicyConversationContext;
};

const GUARANTEE_OR_PAYMENT_PATTERN =
  /(?:guarantee(?:d)?|guaranteed admission|guaranteed visa|visa approved|admission assured|confirm(?:ed)? payment|payment received|гарантир(?:уем|овано|ую)|гарантия|гарантированн\S* поступлен|гарантированн\S* виз|виза одобрен|поступление гарант|подтвержда(?:ем|ю) оплат|оплата подтвержден)/iu;

const SENSITIVE_INTAKE_PATTERN =
  /(?:\bprice\b|\bcost\b|\bfee\b|\bquote\b|\bdiscount\b|\bdays?\b|\bweeks?\b|\bmonths?\b|срок(?:и|ов)?|стоимост\S*|цен\S*|оплат\S*|тариф\S*|скидк\S*)/iu;

const READ_ONLY_TOOLS = new Set([
  "get_conversation_context",
  "get_contact_profile",
  "list_available_slots",
  "propose_reply",
]);

const SCHEDULING_EXTERNAL_TOOLS = new Set([
  "create_appointment_draft",
  "confirm_appointment",
  "reschedule_appointment",
  "cancel_appointment",
]);

/** Pure, deterministic policy decision. It must run at the server action boundary. */
export function evaluateActionPolicy(
  input: EvaluateActionPolicyInput,
): PolicyEvaluation {
  const reasons: string[] = [];
  const body = input.body?.trim() ?? "";

  // Escalation only pauses automation and alerts staff. It never sends a client
  // acknowledgement, so it remains available even when the case is already
  // paused or its channel identity has become unavailable.
  if (input.agentKey === "intake" && input.toolName === "escalate_to_human") {
    return { decision: POLICY_DECISIONS.ALLOW, reasons: [] };
  }

  if (input.conversation.automationPausedAt) {
    reasons.push("automation_paused");
  }
  if (input.conversation.channel !== "TELEGRAM") {
    reasons.push("unsupported_channel");
  }
  if (!input.conversation.hasLinkedChannelIdentity) {
    reasons.push("unverified_contact_channel_link");
  }
  if (input.agentKey === "qa_safety" && !READ_ONLY_TOOLS.has(input.toolName)) {
    reasons.push("qa_has_no_effect_tools");
  }
  if (GUARANTEE_OR_PAYMENT_PATTERN.test(body)) {
    reasons.push("forbidden_guarantee_or_payment_claim");
  }
  if (
    input.agentKey === "intake" &&
    input.toolName === "send_client_message" &&
    input.conversation.consentStatus === "DENIED"
  ) {
    reasons.push("contact_opted_out");
  }

  if (reasons.length > 0) {
    return { decision: POLICY_DECISIONS.DENY, reasons };
  }

  if (READ_ONLY_TOOLS.has(input.toolName)) {
    return { decision: POLICY_DECISIONS.ALLOW, reasons: [] };
  }

  if (input.agentKey === "scheduling" && SCHEDULING_EXTERNAL_TOOLS.has(input.toolName)) {
    return {
      decision: POLICY_DECISIONS.REQUIRE_APPROVAL,
      reasons: ["scheduling_external_write"],
    };
  }

  if (input.agentKey === "intake" && input.toolName === "send_client_message") {
    if (!body) {
      return { decision: POLICY_DECISIONS.DENY, reasons: ["empty_message"] };
    }
    if (body.length > 500) {
      return {
        decision: POLICY_DECISIONS.REQUIRE_APPROVAL,
        reasons: ["intake_message_too_long"],
      };
    }
    if (SENSITIVE_INTAKE_PATTERN.test(body)) {
      return {
        decision: POLICY_DECISIONS.REQUIRE_APPROVAL,
        reasons: ["intake_sensitive_claim"],
      };
    }
    return { decision: POLICY_DECISIONS.ALLOW, reasons: [] };
  }

  if (input.agentKey === "intake" && input.toolName === "update_lead_qualification") {
    return { decision: POLICY_DECISIONS.ALLOW, reasons: [] };
  }

  return { decision: POLICY_DECISIONS.DENY, reasons: ["tool_not_allowed_for_role"] };
}

export async function evaluateActionPolicyForConversation(
  db: DbClient,
  input: Omit<EvaluateActionPolicyInput, "conversation"> & { conversationId: string },
): Promise<PolicyEvaluation> {
  const conversation = await db.conversation.findUnique({
    where: { id: input.conversationId },
    include: {
      lead: { include: { channelIdentities: true } },
      student: { include: { channelIdentities: true } },
    },
  });

  if (!conversation) {
    return { decision: POLICY_DECISIONS.DENY, reasons: ["conversation_not_found"] };
  }

  const identities = [
    ...(conversation.lead?.channelIdentities ?? []),
    ...(conversation.student?.channelIdentities ?? []),
  ];
  return evaluateActionPolicy({
    ...input,
    conversation: {
      channel: conversation.channel,
      automationPausedAt: conversation.automationPausedAt,
      hasLinkedChannelIdentity: identities.some((identity) => identity.channel === conversation.channel),
      consentStatus: conversation.lead?.consentStatus ?? null,
    },
  });
}
