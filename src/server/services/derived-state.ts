import type { NextAction } from "@/server/services/next-action";
import type { RiskLevel } from "@/lib/enums";

const RISK_RANK: Record<RiskLevel, number> = {
  NONE: 0,
  LOW: 1,
  MEDIUM: 2,
  HIGH: 3,
  CRITICAL: 4,
};

const CLOSED_APPLICATION_STATUSES = new Set([
  "SUBMITTED",
  "WAITING_RESULT",
  "ADMITTED",
  "REJECTED",
  "WAITLISTED",
  "ENROLLED",
  "NOT_SELECTED",
]);

const CLOSED_NEXT_ACTION_STATUSES = new Set([
  "SUBMITTED",
  "ADMITTED",
  "REJECTED",
  "ENROLLED",
  "NOT_SELECTED",
]);

export function calculateReadiness(statuses: string[]): number {
  const applicable = statuses.filter((status) => status !== "NOT_APPLICABLE");
  if (applicable.length === 0) return 0;
  const completed = applicable.filter((status) => status === "COMPLETED").length;
  return Math.round((completed / applicable.length) * 100);
}

function daysUntil(value: Date | null | undefined, now: Date): number | null {
  if (!value) return null;
  const start = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const end = Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate());
  return Math.round((end - start) / 86_400_000);
}

function daysWaiting(value: Date | null | undefined, now: Date): number {
  const days = daysUntil(now, value ?? now);
  return days === null ? 0 : Math.max(0, days);
}

function raiseTo(level: RiskLevel, candidate: RiskLevel): RiskLevel {
  return RISK_RANK[candidate] > RISK_RANK[level] ? candidate : level;
}

export function calculateApplicationRisk(input: {
  status: string;
  requirements: Array<{ status: string; isCritical: boolean }>;
  hardDeadline: Date | null;
  waitingDaysMax: number;
  hasOverdueUrgent: boolean;
  now: Date;
}): RiskLevel {
  if (CLOSED_APPLICATION_STATUSES.has(input.status)) return "NONE";
  const daysLeft = daysUntil(input.hardDeadline, input.now);
  const hasBlocker = input.requirements.some(
    (item) =>
      item.isCritical &&
      item.status !== "COMPLETED" &&
      item.status !== "NOT_APPLICABLE"
  );
  const incomplete = input.requirements.some(
    (item) => item.status !== "COMPLETED" && item.status !== "NOT_APPLICABLE"
  );
  let level: RiskLevel = "NONE";
  if (daysLeft !== null && daysLeft <= 2 && hasBlocker) {
    level = raiseTo(level, "CRITICAL");
  }
  if (
    (daysLeft !== null && daysLeft <= 7 && hasBlocker) ||
    input.waitingDaysMax >= 9 ||
    input.hasOverdueUrgent
  ) {
    level = raiseTo(level, "HIGH");
  }
  if ((daysLeft !== null && daysLeft <= 14 && incomplete) || input.waitingDaysMax > 5) {
    level = raiseTo(level, "MEDIUM");
  }
  if (incomplete) level = raiseTo(level, "LOW");
  return level;
}

export function calculateStudentRiskFromSignals(
  applicationRisks: RiskLevel[],
  waitingDaysMax: number,
  hasOverdueUrgent: boolean
): RiskLevel {
  const waitingRisk: RiskLevel =
    waitingDaysMax >= 9
      ? "HIGH"
      : waitingDaysMax >= 6
        ? "MEDIUM"
        : waitingDaysMax >= 3
          ? "LOW"
          : "NONE";
  const levels = [...applicationRisks, waitingRisk];
  if (hasOverdueUrgent) levels.push("HIGH");
  return levels.reduce((max, level) => raiseTo(max, level), "NONE");
}

export type NextActionInput = {
  studentId: string;
  applications: Array<{
    id: string;
    status: string;
    hardDeadline: string | null;
    program?: { name?: string; university?: { name?: string } } | null;
    requirements: Array<{
      id: string;
      name: string;
      status: string;
      isCritical: boolean;
      relatedDocumentId?: string | null;
    }>;
  }>;
  documents: Array<{
    id: string;
    name: string;
    status: string;
    requestedAt: string | null;
  }>;
  tasks: Array<{
    id: string;
    title: string;
    status: string;
    dueDate: string | null;
    applicationId?: string | null;
  }>;
  deadlines: Array<{
    title: string;
    date: string;
    isInternal?: boolean;
    applicationId?: string | null;
  }>;
};

function parseDate(value: string | null | undefined): Date | null {
  return value ? new Date(value) : null;
}

function iso(value: Date): string {
  return value.toISOString().replace(/\.(\d{3})\d+Z$/, ".$1Z");
}

export function computeNextAction(input: NextActionInput, now: Date): NextAction {
  const candidates: NextAction[] = [];

  for (const application of input.applications) {
    if (CLOSED_NEXT_ACTION_STATUSES.has(application.status)) continue;
    const blockers = application.requirements.filter(
      (item) =>
        item.isCritical &&
        item.status !== "COMPLETED" &&
        item.status !== "NOT_APPLICABLE"
    );
    const daysLeft = daysUntil(parseDate(application.hardDeadline), now);
    if (blockers.length > 0 && daysLeft !== null && daysLeft <= 14) {
      const blocker = blockers[0];
      const universityName = application.program?.university?.name || "Подача";
      const programName = application.program?.name;
      candidates.push({
        title: `Не хватает: ${blocker.name}`,
        description: `Нужно для ${universityName}${programName ? ` — ${programName}` : ""}. Дедлайн через ${Math.max(0, daysLeft)} дн.`,
        priority: 1,
        kind: "CRITICAL_BLOCKER",
        studentId: input.studentId,
        applicationId: application.id,
        documentId: blocker.relatedDocumentId,
        dueDate: application.hardDeadline,
      });
    }
  }

  for (const task of input.tasks) {
    const dueDate = parseDate(task.dueDate);
    if (task.status !== "DONE" && dueDate && dueDate < now) {
      candidates.push({
        title: `Просрочено: ${task.title}`,
        description: "Срок задачи истёк — нужно выполнить.",
        priority: 2,
        kind: "OVERDUE_TASK",
        studentId: input.studentId,
        applicationId: task.applicationId ?? null,
        taskId: task.id,
        dueDate: iso(dueDate),
      });
    }
  }

  for (const document of input.documents) {
    if (document.status === "UPLOADED" || document.status === "UNDER_REVIEW") {
      candidates.push({
        title: `Проверить: ${document.name}`,
        description: "Документ загружен и ждёт проверки куратора.",
        priority: 3,
        kind: "DOCUMENT_REVIEW",
        studentId: input.studentId,
        documentId: document.id,
      });
    } else if (document.status === "REQUESTED" || document.status === "NEEDS_CHANGES") {
      candidates.push({
        title: `Ожидание: ${document.name}`,
        description: `Студент не ответил ${daysWaiting(parseDate(document.requestedAt), now)} дн.`,
        priority: 4,
        kind: "WAITING_ON_STUDENT",
        studentId: input.studentId,
        documentId: document.id,
      });
    }
  }

  for (const deadline of input.deadlines) {
    if (deadline.isInternal) continue;
    const daysLeft = daysUntil(parseDate(deadline.date), now);
    if (daysLeft !== null && daysLeft >= 0 && daysLeft <= 14) {
      candidates.push({
        title: deadline.title,
        description: `Ближайший дедлайн через ${daysLeft} дн.`,
        priority: 5,
        kind: "UPCOMING_DEADLINE",
        studentId: input.studentId,
        applicationId: deadline.applicationId ?? null,
        dueDate: deadline.date,
      });
    }
  }

  for (const task of input.tasks) {
    if (task.status === "DONE" || task.status === "BLOCKED") continue;
    candidates.push({
      title: task.title,
      description: "Следующая задача в очереди.",
      priority: 6,
      kind: "NORMAL_TASK",
      studentId: input.studentId,
      applicationId: task.applicationId ?? null,
      taskId: task.id,
      dueDate: task.dueDate,
    });
  }

  if (candidates.length === 0) {
    return {
      title: "Нет срочных действий",
      description: "Все текущие шаги выполнены или ожидают внешнего события.",
      priority: 99,
      kind: "NONE",
      studentId: input.studentId,
    };
  }
  return candidates.reduce((best, item) =>
    item.priority < best.priority ? item : best
  );
}
