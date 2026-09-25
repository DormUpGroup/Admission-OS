import { prisma } from "@/lib/db";
import { studentScopeWhere } from "@/server/auth/guards";
import { isFixtureContact } from "@/lib/telegram-conversation-kind";
import type { UserRole } from "@/lib/enums";
import type { MessageUnreadCounts } from "@/lib/message-unread-counts";

export type { MessageUnreadCounts };

type MessageMeta = {
  note?: string;
  channel?: string;
  from?: string;
};

function parseMeta(raw: string | null): MessageMeta {
  if (!raw) return {};
  try {
    return JSON.parse(raw) as MessageMeta;
  } catch {
    return {};
  }
}

async function countUnreadTelegram(): Promise<number> {
  const candidates = await prisma.conversation.findMany({
    where: {
      channel: "TELEGRAM",
      status: "OPEN",
      lastInboundAt: { not: null },
    },
    select: {
      id: true,
      lastInboundAt: true,
      staffLastReadAt: true,
      lead: {
        select: {
          firstName: true,
          lastName: true,
          channelIdentities: {
            where: { channel: "TELEGRAM" },
            select: { username: true, displayName: true },
            take: 1,
          },
        },
      },
      student: { select: { firstName: true, lastName: true } },
    },
    take: 200,
  });

  let count = 0;
  for (const c of candidates) {
    if (!c.lastInboundAt) continue;
    if (c.staffLastReadAt && c.lastInboundAt <= c.staffLastReadAt) continue;

    const identity = c.lead?.channelIdentities[0];
    const title =
      (c.student
        ? `${c.student.firstName} ${c.student.lastName}`.trim()
        : null) ||
      [c.lead?.firstName, c.lead?.lastName].filter(Boolean).join(" ").trim() ||
      identity?.displayName?.trim() ||
      "";
    if (
      isFixtureContact({
        title,
        username: identity?.username ?? null,
      })
    ) {
      continue;
    }
    count += 1;
  }
  return count;
}

async function countUnansweredSite(
  userId: string,
  role: UserRole,
): Promise<number> {
  const scope = studentScopeWhere(userId, role);
  const activities = await prisma.activity.findMany({
    where: {
      type: "NOTE",
      metadata: { contains: "student-curator" },
      student: {
        status: { notIn: ["ARCHIVED"] },
        AND: [scope],
      },
    },
    select: {
      studentId: true,
      metadata: true,
      createdAt: true,
    },
    orderBy: { createdAt: "desc" },
    take: 300,
  });

  // Walk newest→oldest; first note per student defines unanswered.
  const seen = new Set<string>();
  let unanswered = 0;
  for (const activity of activities) {
    if (seen.has(activity.studentId)) continue;
    const meta = parseMeta(activity.metadata);
    if (meta.channel !== "student-curator" || !meta.note?.trim()) continue;
    seen.add(activity.studentId);
    if (meta.from === "student") unanswered += 1;
  }
  return unanswered;
}

export async function getMessageUnreadCounts(input: {
  userId: string;
  role: UserRole;
}): Promise<MessageUnreadCounts> {
  const [telegram, site] = await Promise.all([
    countUnreadTelegram(),
    countUnansweredSite(input.userId, input.role),
  ]);
  const email = 0;
  const instagram = 0;
  return {
    telegram,
    site,
    email,
    instagram,
    total: telegram + site + email + instagram,
  };
}
