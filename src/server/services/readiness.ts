import type { NextAction } from "@/server/services/next-action";
import type { Requirement } from "@prisma/client";
import type { RiskLevel } from "@/lib/enums";

export function calculateReadiness(
  requirements: Pick<Requirement, "status">[]
): number {
  const applicable = requirements.filter((r) => r.status !== "NOT_APPLICABLE");
  if (applicable.length === 0) return 0;
  const completed = applicable.filter((r) => r.status === "COMPLETED").length;
  return Math.round((completed / applicable.length) * 100);
}

export function criticalIncomplete<
  T extends Pick<Requirement, "status" | "isCritical">,
>(requirements: T[]): T[] {
  return requirements.filter(
    (r) =>
      r.isCritical &&
      r.status !== "COMPLETED" &&
      r.status !== "NOT_APPLICABLE"
  );
}

export function parseNextAction(json: string | null | undefined): NextAction | null {
  if (!json) return null;
  try {
    return JSON.parse(json) as NextAction;
  } catch {
    return null;
  }
}

export const RISK_ORDER: Record<RiskLevel, number> = {
  CRITICAL: 0,
  HIGH: 1,
  MEDIUM: 2,
  LOW: 3,
  NONE: 4,
};
