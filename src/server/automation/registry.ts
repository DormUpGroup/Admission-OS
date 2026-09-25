import { Prisma } from "@prisma/client";
import type { DbClient } from "@/server/commands/outbox";

export type AgentKey = "intake" | "scheduling" | "qa_safety";

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
    allowedTools: [
      "get_conversation_context",
      "list_available_slots",
      "create_appointment_draft",
      "create_approval_request",
    ],
    eventTypes: ["scheduling.requested"],
    policy: {
      approvalRequired: [
        "create_appointment_draft",
        "confirm_appointment",
        "reschedule_appointment",
        "cancel_appointment",
      ],
    },
    promptVersion: "v1",
    policyVersion: "v1",
    maxIterations: 6,
    timeoutSeconds: 90,
    maxCostUsd: new Prisma.Decimal("0.20"),
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
