import { prisma } from "@/lib/db";
import { logActivity } from "@/server/services/activity";
import { recalculateStudent } from "@/server/services/recalculate";

/** Drop the assign-curator half of an onboarding task once a curator is set. */
export function taskTitleAfterCuratorAssigned(title: string): string | "DONE" {
  const trimmed = title.trim().replace(/\s+/g, " ");
  if (/^Назначьте куратора\.?$/iu.test(trimmed)) return "DONE";
  if (/^assign a curator\.?$/iu.test(trimmed)) return "DONE";

  const stripped = trimmed
    .replace(/^Назначьте куратора\s+и\s+/iu, "")
    .replace(/^assign a curator\s+and\s+/iu, "");
  if (stripped === trimmed) return trimmed;
  return stripped.charAt(0).toUpperCase() + stripped.slice(1);
}

export async function assignStudentCurator(input: {
  studentId: string;
  curatorId: string;
  actorUserId: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const [student, curator] = await Promise.all([
    prisma.student.findUnique({
      where: { id: input.studentId },
      select: { id: true, curatorId: true },
    }),
    prisma.user.findUnique({
      where: { id: input.curatorId },
      select: { id: true, role: true, name: true },
    }),
  ]);
  if (!student) return { ok: false, error: "Студент не найден" };
  if (!curator || (curator.role !== "ADMIN" && curator.role !== "CURATOR")) {
    return { ok: false, error: "Куратор не найден" };
  }

  const previousCuratorId = student.curatorId;
  const changed = previousCuratorId !== curator.id;
  if (changed) {
    await prisma.$transaction(async (tx) => {
      await tx.student.update({
        where: { id: student.id },
        data: { curatorId: curator.id },
      });
      await tx.conversation.updateMany({
        where: {
          OR: [
            { studentId: student.id },
            { lead: { convertedStudentId: student.id } },
          ],
        },
        data: { assignedCuratorId: curator.id },
      });
      await tx.lead.updateMany({
        where: { convertedStudentId: student.id },
        data: { assignedCuratorId: curator.id },
      });
      await tx.appointment.updateMany({
        where: {
          OR: [
            { studentId: student.id },
            { lead: { convertedStudentId: student.id } },
          ],
          status: { not: "CANCELLED" },
        },
        data: { assignedCuratorId: curator.id },
      });
      await tx.task.updateMany({
        where: {
          studentId: student.id,
          status: { not: "DONE" },
          OR: [
            { assigneeId: null },
            ...(previousCuratorId ? [{ assigneeId: previousCuratorId }] : []),
          ],
        },
        data: { assigneeId: curator.id },
      });
    });

    await logActivity({
      type: "CURATOR_ASSIGNED",
      studentId: student.id,
      userId: input.actorUserId,
      metadata: { name: curator.name, curatorId: curator.id },
    });
  }

  const openTasks = await prisma.task.findMany({
    where: { studentId: student.id, status: { not: "DONE" } },
    select: { id: true, title: true, assigneeId: true },
  });
  for (const task of openTasks) {
    const next = taskTitleAfterCuratorAssigned(task.title);
    if (next === "DONE") {
      await prisma.task.update({
        where: { id: task.id },
        data: { status: "DONE", assigneeId: curator.id },
      });
      continue;
    }
    if (next !== task.title || task.assigneeId !== curator.id) {
      await prisma.task.update({
        where: { id: task.id },
        data: { title: next, assigneeId: curator.id },
      });
    }
  }

  await recalculateStudent(student.id);
  return { ok: true };
}
