import type { JourneyStageId } from "@/server/services/student-journey/types";
import { previousYearCallNote } from "@/server/services/student-journey/humanize";
import { unknownFieldReasonLabel } from "./field-reasons";
import { addDays, daysBetween, shortStudentName, startOfDay } from "./display";
import { curatorStageForStudent } from "./stage";
import {
  WORK_QUEUE_GROUP_LABELS,
  WORK_QUEUE_GROUPS,
  WORK_QUEUE_STAGE_LABELS,
  type WorkQueueGroup,
  type WorkQueueGroupId,
  type WorkQueueInput,
  type WorkQueueItem,
  type WorkQueueStudentInput,
  type WorkQueueTaskType,
  type WorkQueueView,
} from "./types";

const PRIORITY: Record<WorkQueueTaskType, number> = {
  OVERDUE_DEADLINE: 1,
  UPCOMING_DEADLINE: 2,
  DOCUMENT_REVIEW: 3,
  STUDENT_MESSAGE: 4,
  SHORTLIST_REVIEW: 5,
  CONFIRM_FIELD: 6,
  APPLICATION_REVIEW: 7,
  WAITING_DOCUMENT: 8,
  OPEN_TASK: 9,
  NEW_QUESTIONNAIRE: 99,
  PREVIOUS_YEAR_CALL: 10,
};

const REVIEW_DOC_STATUSES = new Set(["UPLOADED", "UNDER_REVIEW"]);
const WAITING_DOC_STATUSES = new Set(["REQUESTED", "NEEDS_CHANGES"]);

function isConfirmedDeadline(deadline: {
  isHardDeadline: boolean;
  type: string;
}): boolean {
  return deadline.isHardDeadline || deadline.type === "HARD";
}

function formatDeadline(date: Date): string {
  return date.toLocaleDateString("ru-RU", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function studentHref(studentId: string, tab?: string, extra?: string): string {
  const params = new URLSearchParams();
  if (tab) params.set("tab", tab);
  if (extra) {
    const [key, value] = extra.split("=");
    if (key && value) params.set(key, value);
  }
  const qs = params.toString();
  return qs ? `/admin/students/${studentId}?${qs}` : `/admin/students/${studentId}`;
}

function makeItem(input: {
  student: WorkQueueStudentInput;
  type: WorkQueueTaskType;
  group: WorkQueueGroupId;
  action: string;
  reason: string;
  href: string;
  entityId: string;
  deadline?: Date | null;
  deadlineOverdue?: boolean;
  stage: JourneyStageId;
}): WorkQueueItem {
  return {
    id: `${input.type}:${input.student.id}:${input.entityId}`,
    sourceKey: `${input.type}:${input.student.id}:${input.entityId}`,
    type: input.type,
    group: input.group,
    priority: PRIORITY[input.type],
    studentId: input.student.id,
    studentName: shortStudentName(input.student.firstName, input.student.lastName),
    stage: input.stage,
    stageLabel: WORK_QUEUE_STAGE_LABELS[input.stage],
    action: input.action,
    reason: input.reason,
    deadline: input.deadline ? formatDeadline(input.deadline) : null,
    deadlineOverdue: Boolean(input.deadlineOverdue),
    href: input.href,
    assignable: input.student.curatorId == null,
  };
}

function collectItems(
  student: WorkQueueStudentInput,
  now: Date
): WorkQueueItem[] {
  if (
    student.accompanimentStatus &&
    student.accompanimentStatus !== "ACCEPTED"
  ) {
    return [];
  }
  const items: WorkQueueItem[] = [];
  const dismissed = new Set(student.dismissedSourceKeys);
  const stage = curatorStageForStudent(student);
  const today = startOfDay(now);
  const weekEnd = addDays(today, 7);
  const push = (item: WorkQueueItem) => {
    if (!dismissed.has(item.sourceKey)) items.push(item);
  };

  for (const deadline of student.deadlines) {
    if (!isConfirmedDeadline(deadline)) continue;
    const days = daysBetween(today, startOfDay(deadline.date));
    if (days < 0) {
      push(
        makeItem({
          student,
          type: "OVERDUE_DEADLINE",
          group: "URGENT",
          action: "Проверить дедлайн",
          reason: `срок «${deadline.title}» прошёл`,
          href: deadline.applicationId
            ? `/admin/students/${student.id}/applications/${deadline.applicationId}`
            : studentHref(student.id),
          entityId: deadline.id,
          deadline: deadline.date,
          deadlineOverdue: true,
          stage,
        })
      );
    } else if (deadline.date.getTime() <= weekEnd.getTime()) {
      push(
        makeItem({
          student,
          type: "UPCOMING_DEADLINE",
          group: "NEEDS_DECISION",
          action: "Проверить дедлайн",
          reason: `подтверждённый срок «${deadline.title}» в ближайшие 7 дней`,
          href: deadline.applicationId
            ? `/admin/students/${student.id}/applications/${deadline.applicationId}`
            : studentHref(student.id),
          entityId: deadline.id,
          deadline: deadline.date,
          stage,
        })
      );
    }
  }

  for (const application of student.applications) {
    if (!application.hardDeadline) continue;
    const days = daysBetween(today, startOfDay(application.hardDeadline));
    const alreadyCovered = student.deadlines.some(
      (d) =>
        isConfirmedDeadline(d) &&
        d.applicationId === application.id &&
        startOfDay(d.date).getTime() === startOfDay(application.hardDeadline!).getTime()
    );
    if (alreadyCovered) continue;
    if (days < 0) {
      push(
        makeItem({
          student,
          type: "OVERDUE_DEADLINE",
          group: "URGENT",
          action: "Проверить дедлайн",
          reason: "подтверждённый срок подачи прошёл",
          href: `/admin/students/${student.id}/applications/${application.id}`,
          entityId: `app-deadline:${application.id}`,
          deadline: application.hardDeadline,
          deadlineOverdue: true,
          stage: "SUBMISSION",
        })
      );
    } else if (application.hardDeadline.getTime() <= weekEnd.getTime()) {
      push(
        makeItem({
          student,
          type: "UPCOMING_DEADLINE",
          group: "NEEDS_DECISION",
          action: "Проверить дедлайн",
          reason: "подтверждённый срок подачи в ближайшие 7 дней",
          href: `/admin/students/${student.id}/applications/${application.id}`,
          entityId: `app-deadline:${application.id}`,
          deadline: application.hardDeadline,
          stage: "SUBMISSION",
        })
      );
    }
  }

  for (const document of student.documents) {
    if (REVIEW_DOC_STATUSES.has(document.status)) {
      push(
        makeItem({
          student,
          type: "DOCUMENT_REVIEW",
          group: "NEEDS_DECISION",
          action: `Проверить загруженный ${document.name}`,
          reason: "студент загрузил документ, нужна проверка куратора",
          href: studentHref(student.id, "documents"),
          entityId: document.id,
          stage: "DOCUMENTS",
        })
      );
    } else if (WAITING_DOC_STATUSES.has(document.status)) {
      push(
        makeItem({
          student,
          type: "WAITING_DOCUMENT",
          group: "WAITING_STUDENT",
          action: "Напомнить студенту",
          reason:
            document.status === "NEEDS_CHANGES"
              ? `ждём правки: ${document.name}`
              : `ждём загрузку: ${document.name}`,
          href: studentHref(student.id, "documents"),
          entityId: document.id,
          stage: "DOCUMENTS",
        })
      );
    }
  }

  for (const program of student.programs) {
    if (!program.inShortlist && !program.hasApplication) continue;

    const needsReview =
      program.curatorStatus === "NEEDS_REVIEW" ||
      program.eligibilityStatus === "NEEDS_REVIEW";
    if (needsReview) {
      push(
        makeItem({
          student,
          type: "SHORTLIST_REVIEW",
          group: "NEEDS_DECISION",
          action: "Проверить shortlist",
          reason: `программа «${program.programName}» в shortlist, нужна проверка`,
          href: studentHref(
            student.id,
            "programs",
            `focus=${program.programAcademicYearId}`
          ),
          entityId: program.programAcademicYearId,
          stage: "PROGRAMS",
        })
      );
    }

    const previousYear = previousYearCallNote(
      program.academicYear,
      student.intake,
      program.indicativeFromYear
    );
    if (previousYear || program.indicativeFromYear) {
      push(
        makeItem({
          student,
          type: "PREVIOUS_YEAR_CALL",
          group: "ON_WATCH",
          action: "Проверить call",
          reason: previousYear ?? "Есть ориентир за прошлый год",
          href: studentHref(
            student.id,
            "programs",
            `focus=${program.programAcademicYearId}`
          ),
          entityId: `call:${program.programAcademicYearId}`,
          stage: "PROGRAMS",
        })
      );
    }

    if (program.tuitionMissing && !program.tuitionVerified) {
      push(
        makeItem({
          student,
          type: "CONFIRM_FIELD",
          group: "ON_WATCH",
          action: "Подтвердить tuition",
          reason: unknownFieldReasonLabel(
            program.unknownReason,
            student.intake
          ),
          href: studentHref(
            student.id,
            "programs",
            `focus=${program.programAcademicYearId}`
          ),
          entityId: `tuition:${program.programAcademicYearId}`,
          stage: "REQUIREMENTS",
        })
      );
    }
  }

  if (
    student.lastStudentMessageAt &&
    (!student.lastCuratorReplyAt ||
      student.lastStudentMessageAt.getTime() > student.lastCuratorReplyAt.getTime())
  ) {
    push(
      makeItem({
        student,
        type: "STUDENT_MESSAGE",
        group: "NEEDS_DECISION",
        action: "Ответить студенту",
        reason: "есть сообщение без ответа",
        href: `/admin/messages?studentId=${student.id}`,
        entityId: String(student.lastStudentMessageAt.getTime()),
        stage,
      })
    );
  }

  for (const application of student.applications) {
    if (application.status === "READY_FOR_REVIEW") {
      push(
        makeItem({
          student,
          type: "APPLICATION_REVIEW",
          group: "NEEDS_DECISION",
          action: "Проверить заявку",
          reason: "заявка готова к проверке куратора",
          href: `/admin/students/${student.id}/applications/${application.id}`,
          entityId: application.id,
          deadline: application.hardDeadline,
          stage: "SUBMISSION",
        })
      );
    }
  }

  for (const task of student.tasks) {
    if (task.status === "DONE") continue;
    const coveredByDocument =
      task.documentId &&
      student.documents.some(
        (d) =>
          d.id === task.documentId &&
          (REVIEW_DOC_STATUSES.has(d.status) || WAITING_DOC_STATUSES.has(d.status))
      );
    if (coveredByDocument) continue;
    push(
      makeItem({
        student,
        type: "OPEN_TASK",
        group: task.isStudentFacing ? "WAITING_STUDENT" : "ON_WATCH",
        action: task.title,
        reason: task.isStudentFacing
          ? "задача назначена студенту"
          : "открытая задача куратора",
        href: studentHref(student.id),
        entityId: task.id,
        deadline: task.dueDate,
        stage,
      })
    );
  }

  return items;
}

function sortItems(items: WorkQueueItem[]): WorkQueueItem[] {
  return [...items].sort((a, b) => {
    if (a.priority !== b.priority) return a.priority - b.priority;
    if (a.deadlineOverdue !== b.deadlineOverdue) {
      return a.deadlineOverdue ? -1 : 1;
    }
    return a.studentName.localeCompare(b.studentName, "ru");
  });
}

export function buildWorkQueue(input: WorkQueueInput): WorkQueueView {
  const now = input.now ?? new Date();
  const items = sortItems(
    input.students.flatMap((student) => collectItems(student, now))
  );

  const groups: WorkQueueGroup[] = WORK_QUEUE_GROUPS.map((id) => ({
    id,
    label: WORK_QUEUE_GROUP_LABELS[id],
    items: items.filter((item) => item.group === id),
  }));

  return {
    counters: {
      newQuestionnaires: items.filter((i) => i.type === "NEW_QUESTIONNAIRE")
        .length,
      needsReview: items.filter((i) =>
        ["DOCUMENT_REVIEW", "SHORTLIST_REVIEW", "APPLICATION_REVIEW"].includes(
          i.type
        )
      ).length,
      deadlinesNext7Days: items.filter((i) => i.type === "UPCOMING_DEADLINE")
        .length,
    },
    groups,
    items,
    empty: items.length === 0,
  };
}
