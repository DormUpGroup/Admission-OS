import { prisma } from "@/lib/db";
import { requireStaff, studentScopeWhere } from "@/server/auth/guards";
import { EmptyState } from "@/components/empty-state";
import { SiteMessenger } from "@/components/admin/site-messenger";
import type { ChannelListItem } from "@/components/admin/channel-messenger";
import { fullName } from "@/lib/utils";

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

export default async function AdminSiteMessagesPage({
  searchParams,
}: {
  searchParams: Promise<{ studentId?: string }>;
}) {
  const session = await requireStaff();
  const { studentId } = await searchParams;
  const scope = studentScopeWhere(session.user.id, session.user.role);

  const activities = await prisma.activity.findMany({
    where: {
      type: "NOTE",
      metadata: { contains: "student-curator" },
      student: {
        status: { notIn: ["ARCHIVED"] },
        AND: [scope],
      },
    },
    include: {
      student: { select: { id: true, firstName: true, lastName: true } },
      user: { select: { name: true } },
    },
    orderBy: { createdAt: "desc" },
    take: 200,
  });

  const conversations = new Map<
    string,
    {
      studentId: string;
      name: string;
      lastText: string;
      lastAt: Date;
      unanswered: boolean;
    }
  >();

  for (const activity of [...activities].reverse()) {
    const meta = parseMeta(activity.metadata);
    if (meta.channel !== "student-curator" || !meta.note?.trim()) continue;
    const fromStudent = meta.from === "student";
    const existing = conversations.get(activity.studentId);
    conversations.set(activity.studentId, {
      studentId: activity.studentId,
      name: fullName(activity.student.firstName, activity.student.lastName),
      lastText: meta.note.trim(),
      lastAt: activity.createdAt,
      unanswered: fromStudent,
    });
    if (existing && !fromStudent) {
      conversations.set(activity.studentId, {
        ...conversations.get(activity.studentId)!,
        unanswered: false,
      });
    }
  }

  const list = [...conversations.values()].sort((a, b) => {
    if (a.unanswered !== b.unanswered) return a.unanswered ? -1 : 1;
    return b.lastAt.getTime() - a.lastAt.getTime();
  });

  const conversationsUi: ChannelListItem[] = list.map((item) => ({
    id: item.studentId,
    title: item.name,
    preview: item.lastText,
    previewAt: item.lastAt.toISOString(),
    badge: item.unanswered ? "Без ответа" : null,
    badgeTone: item.unanswered ? "warning" : null,
  }));

  const selectedId =
    studentId && list.some((c) => c.studentId === studentId)
      ? studentId
      : (list[0]?.studentId ?? null);

  const selected = selectedId
    ? await prisma.student.findUnique({
        where: { id: selectedId },
        select: { id: true, firstName: true, lastName: true },
      })
    : null;

  const thread = selectedId
    ? activities
        .filter((a) => a.studentId === selectedId)
        .map((activity) => {
          const meta = parseMeta(activity.metadata);
          if (meta.channel !== "student-curator" || !meta.note?.trim()) {
            return null;
          }
          return {
            id: activity.id,
            text: meta.note.trim(),
            fromStudent: meta.from === "student",
            createdAt: activity.createdAt,
          };
        })
        .filter((item): item is NonNullable<typeof item> => Boolean(item))
        .reverse()
    : [];

  if (list.length === 0 && !selected) {
    return (
      <div className="-m-6 flex h-[calc(100vh-3rem)] min-h-[480px] overflow-hidden border-t border-black/5 bg-[#eef2f5]">
        <div className="flex flex-1 items-center justify-center">
          <EmptyState
            title="Нет сообщений"
            description="Когда студент напишет, диалог появится здесь."
          />
        </div>
      </div>
    );
  }

  return (
    <SiteMessenger
      conversations={conversationsUi}
      active={
        selected
          ? {
              id: selected.id,
              studentId: selected.id,
              title: fullName(selected.firstName, selected.lastName),
              subtitle: "Сайт · портал Immigrome",
              messages: thread.map((m) => ({
                id: m.id,
                outbound: !m.fromStudent,
                body: m.text,
                createdAt: m.createdAt.toISOString(),
                senderName: m.fromStudent
                  ? fullName(selected.firstName, selected.lastName)
                  : "Куратор",
              })),
            }
          : null
      }
    />
  );
}
