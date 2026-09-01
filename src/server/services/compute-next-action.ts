import type {
  Application,
  Document,
  Requirement,
  Task,
  Deadline,
} from "@prisma/client";
import { daysUntil } from "@/lib/utils";
import { criticalIncomplete } from "./readiness";
import { daysWaiting, isWaitingDocumentStatus } from "./waiting";
import { emptyNextAction, type NextAction } from "./next-action";

type Input = {
  studentId: string;
  applications: (Pick<
    Application,
    "id" | "hardDeadline" | "status"
  > & {
    requirements: (Pick<
      Requirement,
      "id" | "name" | "status" | "isCritical" | "relatedDocumentId"
    > & { relatedDocument?: Pick<Document, "id" | "name" | "status"> | null })[];
    program?: { name: string; university?: { name: string } | null } | null;
  })[];
  documents: Pick<
    Document,
    "id" | "name" | "status" | "requestedAt" | "uploadedAt"
  >[];
  tasks: Pick<
    Task,
    "id" | "title" | "status" | "priority" | "dueDate" | "applicationId"
  >[];
  deadlines: Pick<
    Deadline,
    "id" | "title" | "date" | "isHardDeadline" | "isInternal" | "applicationId"
  >[];
};

export function computeNextAction(input: Input): NextAction {
  const candidates: NextAction[] = [];

  for (const app of input.applications) {
    if (["SUBMITTED", "ADMITTED", "REJECTED", "ENROLLED", "NOT_SELECTED"].includes(app.status)) {
      continue;
    }
    const blockers = criticalIncomplete(app.requirements);
    const daysLeft = app.hardDeadline ? daysUntil(app.hardDeadline) : 999;
    if (blockers.length > 0 && daysLeft <= 14) {
      const b = blockers[0];
      const uni = app.program?.university?.name ?? "Подача";
      candidates.push({
        title: `Не хватает: ${b.name}`,
        description: `Нужно для ${uni}${app.program?.name ? ` — ${app.program.name}` : ""}.${daysLeft <= 30 ? ` Дедлайн через ${Math.max(0, daysLeft)} дн.` : ""}`,
        priority: daysLeft <= 2 ? 1 : 1,
        kind: "CRITICAL_BLOCKER",
        studentId: input.studentId,
        applicationId: app.id,
        documentId: b.relatedDocumentId,
        dueDate: app.hardDeadline?.toISOString() ?? null,
      });
    }
  }

  for (const task of input.tasks) {
    if (task.status === "DONE") continue;
    if (task.dueDate && daysUntil(task.dueDate) < 0) {
      candidates.push({
        title: `Просрочено: ${task.title}`,
        description: "Срок задачи истёк — нужно выполнить.",
        priority: 2,
        kind: "OVERDUE_TASK",
        studentId: input.studentId,
        applicationId: task.applicationId,
        taskId: task.id,
        dueDate: task.dueDate.toISOString(),
      });
    }
  }

  for (const doc of input.documents) {
    if (doc.status === "UPLOADED" || doc.status === "UNDER_REVIEW") {
      candidates.push({
        title: `Проверить: ${doc.name}`,
        description: "Документ загружен и ждёт проверки куратора.",
        priority: 3,
        kind: "DOCUMENT_REVIEW",
        studentId: input.studentId,
        documentId: doc.id,
      });
    }
  }

  for (const doc of input.documents) {
    if (isWaitingDocumentStatus(doc.status)) {
      const days = daysWaiting(doc.requestedAt);
      candidates.push({
        title: `Ожидание: ${doc.name}`,
        description: `Студент не ответил ${days} дн.`,
        priority: 4,
        kind: "WAITING_ON_STUDENT",
        studentId: input.studentId,
        documentId: doc.id,
      });
    }
  }

  for (const dl of input.deadlines) {
    if (dl.isInternal) continue;
    const left = daysUntil(dl.date);
    if (left >= 0 && left <= 14) {
      candidates.push({
        title: dl.title,
        description: `Ближайший дедлайн через ${left} дн.`,
        priority: 5,
        kind: "UPCOMING_DEADLINE",
        studentId: input.studentId,
        applicationId: dl.applicationId,
        dueDate: dl.date.toISOString(),
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
      applicationId: task.applicationId,
      taskId: task.id,
      dueDate: task.dueDate?.toISOString() ?? null,
    });
  }

  if (candidates.length === 0) return emptyNextAction(input.studentId);
  candidates.sort((a, b) => a.priority - b.priority);
  return candidates[0];
}
