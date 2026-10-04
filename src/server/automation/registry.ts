import { Prisma } from "@prisma/client";
import type { DbClient } from "@/server/commands/outbox";

export type AgentKey =
  | "intake"
  | "scheduling"
  | "onboarding"
  | "program"
  | "qa_safety";

export type AgentDefinitionSpec = {
  key: AgentKey;
  enabledByDefault: boolean;
  autonomyLevel: string;
  allowedTools: string[];
  eventTypes: string[];
  policy: Prisma.InputJsonObject;
  promptVersion: string;
  policyVersion: string;
  maxIterations: number;
  timeoutSeconds: number;
  maxCostUsd: Prisma.Decimal;
};

export const AGENT_DEFINITION_SPECS: readonly AgentDefinitionSpec[] = [
  {
    key: "intake",
    enabledByDefault: false,
    autonomyLevel: "LOW_RISK_AUTONOMY",
    allowedTools: [
      "get_conversation_context",
      "get_contact_profile",
      "update_lead_qualification",
      "propose_reply",
      "send_client_message",
      "send_booking_link",
      "escalate_to_human",
    ],
    eventTypes: ["message.received"],
    policy: {
      forbidden: ["payment_confirmation", "admission_or_visa_promise"],
      externalWrites: ["send_client_message"],
    },
    promptVersion: "v1",
    policyVersion: "v1",
    maxIterations: 8,
    timeoutSeconds: 120,
    maxCostUsd: new Prisma.Decimal("0.25"),
  },
  {
    key: "scheduling",
    enabledByDefault: false,
    autonomyLevel: "APPROVAL_FOR_EXTERNAL_WRITE",
    allowedTools: ["commit_booked_consultation"],
    eventTypes: ["scheduling.requested"],
    policy: {
      effect: "calendar_meet_email",
      timeSource: "appointment_row",
    },
    promptVersion: "v1",
    policyVersion: "v1",
    maxIterations: 6,
    timeoutSeconds: 90,
    maxCostUsd: new Prisma.Decimal("0.20"),
  },
  {
    key: "onboarding",
    enabledByDefault: false,
    autonomyLevel: "DRAFT_ONLY",
    allowedTools: [
      "get_onboarding_context",
      "submit_onboarding_result",
      "create_curator_task",
    ],
    eventTypes: ["client.activated"],
    policy: {
      forbidden: ["client_status_change", "telegram_send", "legal_sufficiency"],
    },
    promptVersion: "v1",
    policyVersion: "v1",
    maxIterations: 6,
    timeoutSeconds: 90,
    maxCostUsd: new Prisma.Decimal("0.20"),
  },
  {
    key: "program",
    enabledByDefault: false,
    autonomyLevel: "LOW_RISK_AUTONOMY",
    allowedTools: ["program.match_job.start", "program.match_job.status"],
    eventTypes: ["programs.match.requested"],
    policy: {
      effect: "async_match_job",
      forbidden: ["wait_for_match_completion", "change_shortlist_rules"],
    },
    promptVersion: "v1",
    policyVersion: "v1",
    maxIterations: 4,
    timeoutSeconds: 90,
    maxCostUsd: new Prisma.Decimal("0.15"),
  },
  {
    key: "qa_safety",
    enabledByDefault: true,
    autonomyLevel: "POLICY_GATE",
    allowedTools: [],
    eventTypes: [],
    policy: { mode: "deterministic_server_gate" },
    promptVersion: "v1",
    policyVersion: "v1",
    maxIterations: 1,
    timeoutSeconds: 10,
    maxCostUsd: new Prisma.Decimal("0.00"),
  },
] as const;

export const AGENT_DEFINITIONS_BY_KEY = new Map(
  AGENT_DEFINITION_SPECS.map((spec) => [spec.key, spec]),
);

/**
 * Seed/update static contract fields without switching an agent on. The enabled
 * flag is operational state and is intentionally never overwritten here.
 */
export async function syncAgentDefinitions(db: DbClient): Promise<void> {
  for (const spec of AGENT_DEFINITION_SPECS) {
    await db.agentDefinition.upsert({
      where: { key: spec.key },
      create: {
        key: spec.key,
        version: spec.promptVersion,
        enabled: spec.enabledByDefault,
        autonomyLevel: spec.autonomyLevel,
        allowedToolsJson: spec.allowedTools,
        eventTypesJson: spec.eventTypes,
        approvalPolicyJson: spec.policy,
        policyJson: spec.policy,
        promptVersion: spec.promptVersion,
        policyVersion: spec.policyVersion,
        maxIterations: spec.maxIterations,
        timeoutSeconds: spec.timeoutSeconds,
        maxCostUsd: spec.maxCostUsd,
      },
      update: {
        version: spec.promptVersion,
        autonomyLevel: spec.autonomyLevel,
        allowedToolsJson: spec.allowedTools,
        eventTypesJson: spec.eventTypes,
        approvalPolicyJson: spec.policy,
        policyJson: spec.policy,
        promptVersion: spec.promptVersion,
        policyVersion: spec.policyVersion,
        maxIterations: spec.maxIterations,
        timeoutSeconds: spec.timeoutSeconds,
        maxCostUsd: spec.maxCostUsd,
      },
    });
  }
}
