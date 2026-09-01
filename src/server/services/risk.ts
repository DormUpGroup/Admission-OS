import type { Application, Document, Requirement, Task } from "@prisma/client";
import type { RiskLevel } from "@/lib/enums";
import { daysUntil } from "@/lib/utils";
import { criticalIncomplete } from "./readiness";
import { daysWaiting, waitingRiskFromDays } from "./waiting";

type RiskInput = {
  applications: (Pick<
    Application,
    "hardDeadline" | "status" | "riskLevel"
  > & {
    requirements: Pick<Requirement, "status" | "isCritical">[];
  })[];
  documents: Pick<Document, "status" | "requestedAt">[];
  tasks: Pick<Task, "status" | "priority" | "dueDate">[];
};

const RANK: Record<RiskLevel, number> = {
  NONE: 0,
  LOW: 1,
  MEDIUM: 2,
  HIGH: 3,
  CRITICAL: 4,
};

function maxRisk(...levels: RiskLevel[]): RiskLevel {
  return levels.reduce((a, b) => (RANK[b] > RANK[a] ? b : a), "NONE" as RiskLevel);
}

export function calculateApplicationRisk(
  application: Pick<Application, "hardDeadline" | "status"> & {
    requirements: Pick<Requirement, "status" | "isCritical">[];
  },
  waitingDaysMax = 0,
  hasOverdueUrgent = false
): RiskLevel {
  if (
    ["SUBMITTED", "WAITING_RESULT", "ADMITTED", "REJECTED", "WAITLISTED", "ENROLLED", "NOT_SELECTED"].includes(
      application.status
    )
  ) {
    return "NONE";
  }

  const blockers = criticalIncomplete(application.requirements);
  const hasCriticalBlocker = blockers.length > 0;
  const incomplete = application.requirements.some(
    (r) => r.status !== "COMPLETED" && r.status !== "NOT_APPLICABLE"
  );
  const daysLeft = application.hardDeadline
    ? daysUntil(application.hardDeadline)
    : null;

  let level: RiskLevel = "NONE";

  if (daysLeft !== null && daysLeft <= 2 && hasCriticalBlocker) {
    level = maxRisk(level, "CRITICAL");
  }
  if (
    (daysLeft !== null && daysLeft <= 7 && hasCriticalBlocker) ||
    waitingDaysMax > 9 ||
    hasOverdueUrgent
  ) {
    level = maxRisk(level, "HIGH");
  }
  if (
    (daysLeft !== null && daysLeft <= 14 && incomplete) ||
    waitingDaysMax > 5
  ) {
    level = maxRisk(level, "MEDIUM");
  }
  if (incomplete) {
    level = maxRisk(level, "LOW");
  }

  return level;
}

export function calculateStudentRisk(input: RiskInput): RiskLevel {
  const waitingDocs = input.documents.filter(
    (d) => d.status === "REQUESTED" || d.status === "NEEDS_CHANGES"
  );
  const waitingDaysMax = waitingDocs.reduce(
    (max, d) => Math.max(max, daysWaiting(d.requestedAt)),
    0
  );
  const hasOverdueUrgent = input.tasks.some(
    (t) =>
      t.status !== "DONE" &&
      t.priority === "URGENT" &&
      t.dueDate &&
      daysUntil(t.dueDate) < 0
  );

  const appRisks = input.applications.map((a) =>
    calculateApplicationRisk(a, waitingDaysMax, hasOverdueUrgent)
  );

  const waitingRisk = waitingRiskFromDays(waitingDaysMax);
  return maxRisk(...appRisks, waitingRisk, hasOverdueUrgent ? "HIGH" : "NONE");
}
