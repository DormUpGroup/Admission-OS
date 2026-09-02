import { prisma } from "@/lib/db";

export async function createInAppNotification(input: {
  userId: string;
  studentId?: string | null;
  type: string;
  title: string;
  body: string;
  metadata?: Record<string, unknown>;
}) {
  return prisma.inAppNotification.create({
    data: {
      userId: input.userId,
      studentId: input.studentId ?? null,
      type: input.type,
      title: input.title,
      body: input.body,
      metadataJson: input.metadata ? JSON.stringify(input.metadata) : null,
    },
  });
}

export async function listNotificationsForUser(
  userId: string,
  options?: { unreadOnly?: boolean; limit?: number }
) {
  return prisma.inAppNotification.findMany({
    where: {
      userId,
      ...(options?.unreadOnly ? { readAt: null } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: options?.limit ?? 50,
  });
}

export async function markNotificationRead(id: string, userId: string) {
  const n = await prisma.inAppNotification.findFirst({
    where: { id, userId },
  });
  if (!n) return null;
  return prisma.inAppNotification.update({
    where: { id },
    data: { readAt: new Date() },
  });
}

export async function unreadNotificationCount(userId: string) {
  return prisma.inAppNotification.count({
    where: { userId, readAt: null },
  });
}
