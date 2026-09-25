import { createHash } from "crypto";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";

export const APPROVAL_STATUS = {
  PENDING: "PENDING",
  APPROVED: "APPROVED",
  REJECTED: "REJECTED",
  EXPIRED: "EXPIRED",
  EXECUTED: "EXECUTED",
} as const;

type CanonicalValue =
  | null
  | boolean
  | number
  | string
  | CanonicalValue[]
  | { [key: string]: CanonicalValue };

function canonicalize(value: unknown): CanonicalValue {
  if (value === null || typeof value === "boolean" || typeof value === "string") {
    return value;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("Approval payload contains a non-finite number");
    return value;
  }
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, nested]) => [key, canonicalize(nested)]),
    );
  }
  throw new Error("Approval payload must be JSON-serializable");
}

export function canonicalApprovalPayload(payload: unknown): string {
  return JSON.stringify(canonicalize(payload));
}

export function approvalPayloadHash(payload: unknown): string {
  return createHash("sha256").update(canonicalApprovalPayload(payload)).digest("hex");
}

export async function createApprovalRequest(input: {
  agentRunId?: string | null;
  actionKey: string;
  payload: Prisma.InputJsonValue;
  requestedByType: "AGENT" | "SYSTEM" | "USER";
  requestedById?: string | null;
  expiresAt?: Date;
  riskClass?: string;
  subjectType?: string;
  subjectId?: string;
}) {
  const payloadHash = approvalPayloadHash(input.payload);
  const canonical = canonicalize(input.payload) as Prisma.InputJsonValue;
  const payloadRecord =
    input.payload && typeof input.payload === "object" && !Array.isArray(input.payload)
      ? (input.payload as Record<string, unknown>)
      : {};
  const conversationId =
    typeof payloadRecord.conversationId === "string" ? payloadRecord.conversationId : null;

  return prisma.approvalRequest.create({
    data: {
      agentRunId: input.agentRunId ?? null,
      action: input.actionKey,
      actionKey: input.actionKey,
      riskClass: input.riskClass ?? "MEDIUM",
      subjectType: input.subjectType ?? (conversationId ? "Conversation" : "Unknown"),
      subjectId: input.subjectId ?? conversationId ?? input.agentRunId ?? "unknown",
      proposedJson: canonical,
      payloadJson: canonical,
      payloadHash,
      requestedByType: input.requestedByType,
      requestedById: input.requestedById ?? null,
      expiresAt: input.expiresAt ?? new Date(Date.now() + 30 * 60 * 1000),
    },
  });
}

/**
 * Approves only the exact payload that was displayed to a human. This function
 * never executes an external effect; a future command must consume APPROVED
 * with another hash + expiry check before acting.
 */
export async function decideApprovalRequest(input: {
  approvalId: string;
  decision: "APPROVE" | "REJECT";
  decidedById: string;
  expectedPayloadHash: string;
  reason?: string | null;
  now?: Date;
}) {
  const now = input.now ?? new Date();
  return prisma.$transaction(async (tx) => {
    const current = await tx.approvalRequest.findUnique({
      where: { id: input.approvalId },
    });
    if (!current) throw new Error("Approval request not found");
    if (current.status !== APPROVAL_STATUS.PENDING) {
      throw new Error("Approval request is no longer pending");
    }

    const storedHash = approvalPayloadHash(current.payloadJson);
    if (storedHash !== current.payloadHash || input.expectedPayloadHash !== current.payloadHash) {
      throw new Error("Approval payload no longer matches the reviewed action");
    }
    if (current.expiresAt && current.expiresAt <= now) {
      await tx.approvalRequest.update({
        where: { id: current.id },
        data: { status: APPROVAL_STATUS.EXPIRED, decidedAt: now },
      });
      throw new Error("Approval request has expired");
    }

    return tx.approvalRequest.update({
      where: { id: current.id },
      data: {
        status:
          input.decision === "APPROVE"
            ? APPROVAL_STATUS.APPROVED
            : APPROVAL_STATUS.REJECTED,
        decidedById: input.decidedById,
        decisionReason: input.reason?.trim() || null,
        decisionNote: input.reason?.trim() || null,
        decidedAt: now,
      },
    });
  });
}
