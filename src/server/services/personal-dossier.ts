import { prisma } from "@/lib/db";
import { logActivity } from "@/server/services/activity";

/** Base personal-file checklist every student should fill. */
export const PERSONAL_DOSSIER_DOCUMENTS = [
  { name: "Загранпаспорт", category: "PERSONAL" },
  { name: "Диплом или аттестат", category: "EDUCATION" },
  { name: "Приложение к диплому / транскрипт", category: "EDUCATION" },
  { name: "Фото 3×4", category: "PERSONAL" },
  { name: "Резюме (CV)", category: "OTHER" },
] as const;

/**
 * Creates missing personal-file rows as REQUESTED so the student can upload
 * and the curator summary shows a real checklist instead of "—".
 */
export async function ensurePersonalDossierDocuments(
  studentId: string,
  actorUserId?: string | null,
) {
  const existing = await prisma.document.findMany({
    where: { studentId },
    select: { name: true },
  });
  const have = new Set(existing.map((row) => row.name.trim().toLowerCase()));
  const missing = PERSONAL_DOSSIER_DOCUMENTS.filter(
    (item) => !have.has(item.name.trim().toLowerCase()),
  );
  if (missing.length === 0) return { created: 0 };

  const student = await prisma.student.findUnique({
    where: { id: studentId },
    select: { curatorId: true },
  });
  const assigneeId = actorUserId ?? student?.curatorId ?? undefined;
  const now = new Date();
  const dueDate = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

  await prisma.$transaction(async (tx) => {
    for (const item of missing) {
      const doc = await tx.document.create({
        data: {
          studentId,
          name: item.name,
          category: item.category,
          status: "REQUESTED",
          requestedAt: now,
          lastReminderAt: now,
        },
      });
      await tx.task.create({
        data: {
          title: `Загрузить: ${doc.name}`,
          studentId,
          documentId: doc.id,
          assigneeId,
          status: "WAITING",
          priority: "HIGH",
          isStudentFacing: true,
          dueDate,
        },
      });
    }
  });

  await logActivity({
    type: "DOCUMENT_REQUESTED",
    studentId,
    userId: actorUserId ?? null,
    metadata: {
      name: "Личное дело",
      count: missing.length,
      items: missing.map((item) => item.name),
    },
  });

  return { created: missing.length };
}
