import Link from "next/link";
import { prisma } from "@/lib/db";
import { requireStaff, studentScopeWhere } from "@/server/auth/guards";
import { sendCuratorMessageAction } from "@/server/actions";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/empty-state";
import { Button } from "@/components/ui/button";
import { fullName, formatDate } from "@/lib/utils";

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

export default async function AdminMessagesPage({
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

  const selectedId = studentId || list[0]?.studentId;
  const selected = selectedId
    ? await prisma.student.findUnique({
        where: { id: selectedId },
        select: { id: true, firstName: true, lastName: true, curatorId: true },
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
            author: meta.from === "student"
              ? fullName(activity.student.firstName, activity.student.lastName)
              : activity.user?.name || "Куратор",
            createdAt: activity.createdAt,
          };
        })
        .filter((item): item is NonNullable<typeof item> => Boolean(item))
        .reverse()
    : [];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Сообщения"
        description="Переписка со студентами"
      />

      {list.length === 0 && !selected ? (
        <EmptyState
          title="Нет сообщений"
          description="Когда студент напишет, диалог появится здесь."
        />
      ) : (
        <div className="grid gap-6 lg:grid-cols-[280px_1fr]">
          <ul className="space-y-1">
            {list.map((item) => (
              <li key={item.studentId}>
                <Link
                  href={`/admin/messages?studentId=${item.studentId}`}
                  className={`block rounded-xl border px-3 py-2 ${
                    item.studentId === selectedId
                      ? "border-[var(--brand)] bg-white"
                      : "border-transparent hover:bg-white"
                  }`}
                >
                  <p className="text-sm font-medium">{item.name}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {item.lastText}
                  </p>
                  {item.unanswered ? (
                    <p className="mt-1 text-[11px] text-[var(--warning-fg)]">
                      Без ответа
                    </p>
                  ) : null}
                </Link>
              </li>
            ))}
          </ul>

          <div className="space-y-4">
            {selected ? (
              <>
                <div className="flex items-center justify-between gap-2">
                  <h2 className="text-sm font-semibold">
                    {fullName(selected.firstName, selected.lastName)}
                  </h2>
                  <Button asChild size="sm" variant="outline">
                    <Link href={`/admin/students/${selected.id}`}>Открыть</Link>
                  </Button>
                </div>
                {thread.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    Напишите первое сообщение.
                  </p>
                ) : (
                  <ul className="space-y-3">
                    {thread.map((message) => (
                      <li
                        key={message.id}
                        className="rounded-2xl border border-border bg-white px-4 py-3"
                      >
                        <p className="text-xs text-muted-foreground">
                          {message.author} · {formatDate(message.createdAt)}
                        </p>
                        <p className="mt-1 whitespace-pre-wrap text-sm">
                          {message.text}
                        </p>
                      </li>
                    ))}
                  </ul>
                )}
                <form action={sendCuratorMessageAction} className="space-y-2">
                  <input type="hidden" name="studentId" value={selected.id} />
                  <textarea
                    name="message"
                    required
                    rows={4}
                    maxLength={2000}
                    placeholder="Написать студенту"
                    className="min-h-24 w-full rounded-xl border border-input bg-card px-3 py-2 text-sm"
                  />
                  <Button type="submit" size="sm">
                    Отправить
                  </Button>
                </form>
              </>
            ) : null}
          </div>
        </div>
      )}
    </div>
  );
}
