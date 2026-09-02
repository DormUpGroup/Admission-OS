import type { Prisma } from "@prisma/client";
import type { ActivityType } from "@/lib/enums";
import { prisma } from "@/lib/db";

export async function logActivity(input: {
  type: ActivityType;
  studentId: string;
  applicationId?: string | null;
  userId?: string | null;
  metadata?: Record<string, unknown> | string | null;
}) {
  const metadata =
    typeof input.metadata === "string"
      ? input.metadata
      : input.metadata
        ? JSON.stringify(input.metadata)
        : null;

  return prisma.activity.create({
    data: {
      type: input.type,
      studentId: input.studentId,
      applicationId: input.applicationId ?? null,
      userId: input.userId ?? null,
      metadata,
    },
  });
}

export function activityLabel(type: ActivityType, metadata?: string | null) {
  const meta = (() => {
    try {
      return metadata ? (JSON.parse(metadata) as Record<string, string>) : {};
    } catch {
      return {};
    }
  })();

  switch (type) {
    case "STUDENT_CREATED":
      return "Профиль студента создан";
    case "APPLICATION_CREATED":
      return `Подача создана${meta.university ? `: ${meta.university}` : ""}`;
    case "APPLICATION_STATUS_CHANGED":
      return `Статус подачи → ${meta.to ?? meta.status ?? "обновлён"}`;
    case "DOCUMENT_REQUESTED":
      return `Запрошен документ: ${meta.name ?? "документ"}`;
    case "DOCUMENT_UPLOADED":
      return `Студент загрузил: ${meta.name ?? "документ"}`;
    case "DOCUMENT_APPROVED":
      return `Одобрено: ${meta.name ?? "документ"}`;
    case "DOCUMENT_NEEDS_CHANGES":
      return `${meta.name ?? "Документ"} — нужны правки`;
    case "TASK_CREATED":
      return `Задача создана: ${meta.title ?? ""}`;
    case "TASK_COMPLETED":
      return `Задача выполнена: ${meta.title ?? ""}`;
    case "DEADLINE_CREATED":
      return `Добавлен дедлайн: ${meta.title ?? ""}`;
    case "APPLICATION_SUBMITTED":
      return "Подача отмечена как поданная";
    case "NOTE":
      return meta.note || "Сообщение";
    case "QUEUE_ITEM_DISMISSED":
      return "Задача очереди отмечена как просмотренная";
    case "ACCOMPANIMENT_ACCEPTED":
      return "Принят на сопровождение";
    case "ACCOMPANIMENT_REJECTED":
      return "Не принят на сопровождение";
    case "ACCOMPANIMENT_CLARIFICATION_REQUESTED":
      return "Запрошено уточнение по анкете";
    case "PROGRAM_MATCHES_RESET":
      return "Подбор программ сброшен";
    case "INTAKE_LIMIT_CHANGED":
      return "Изменён лимит набора";
    default:
      return type;
  }
}

export type ActivityWithUser = Prisma.ActivityGetPayload<{
  include: { user: { select: { name: true } } };
}>;
