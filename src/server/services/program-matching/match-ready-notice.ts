import { fullName } from "@/lib/utils";
import type { DbClient } from "@/server/commands/outbox";

export const PROGRAM_MATCH_READY_TYPE = "PROGRAM_MATCH_READY";

export function matchReadyHref(studentId: string, activityId: string) {
  const params = new URLSearchParams({
    tab: "history",
    event: activityId,
  });
  return `/admin/students/${studentId}?${params.toString()}#activity-${activityId}`;
}

export function matchReadyToastText(studentName: string) {
  return `У ${studentName} завершился подбор программ. Посмотрите.`;
}

export async function notifyProgramMatchReady(
  db: DbClient,
  input: { studentId: string; jobId: string },
) {
  const student = await db.student.findUnique({
    where: { id: input.studentId },
    select: { firstName: true, lastName: true, curatorId: true },
  });
  if (!student) return { notified: 0 };

  const activity = await db.activity.findFirst({
    where: { studentId: input.studentId, type: "PROGRAM_MATCH_GENERATED" },
    orderBy: { createdAt: "desc" },
    select: { id: true },
  });
  if (!activity) return { notified: 0 };

  const staff = await db.user.findMany({
    where: { role: { in: ["ADMIN", "CURATOR"] } },
    select: { id: true },
  });
  const userIds = [
    ...new Set([
      ...staff.map((user) => user.id),
      ...(student.curatorId ? [student.curatorId] : []),
    ]),
  ];
  if (userIds.length === 0) return { notified: 0 };

  const name = fullName(student.firstName, student.lastName);
  const href = matchReadyHref(input.studentId, activity.id);
  const text = matchReadyToastText(name);
  let notified = 0;

  for (const userId of userIds) {
    const existing = await db.inAppNotification.findFirst({
      where: {
        userId,
        studentId: input.studentId,
        type: PROGRAM_MATCH_READY_TYPE,
        metadataJson: { contains: input.jobId },
      },
      select: { id: true },
    });
    if (existing) continue;

    await db.inAppNotification.create({
      data: {
        userId,
        studentId: input.studentId,
        type: PROGRAM_MATCH_READY_TYPE,
        title: name,
        body: text,
        metadataJson: JSON.stringify({
          jobId: input.jobId,
          activityId: activity.id,
          href,
        }),
      },
    });
    notified += 1;
  }

  return { notified, activityId: activity.id };
}
