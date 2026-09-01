import type { DocumentStatus, RiskLevel } from "@/lib/enums";
import { daysBetween } from "@/lib/utils";

export function daysWaiting(requestedAt: Date | null | undefined) {
  if (!requestedAt) return 0;
  return Math.max(0, daysBetween(requestedAt));
}

export function waitingRiskFromDays(days: number): RiskLevel {
  if (days >= 9) return "HIGH";
  if (days >= 6) return "MEDIUM";
  if (days >= 3) return "LOW";
  return "NONE";
}

export function isWaitingDocumentStatus(status: DocumentStatus | string) {
  return status === "REQUESTED" || status === "NEEDS_CHANGES";
}
