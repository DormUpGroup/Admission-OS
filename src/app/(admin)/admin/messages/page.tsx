import Link from "next/link";
import { prisma } from "@/lib/db";
import { requireStaff, studentScopeWhere } from "@/server/auth/guards";
import { sendCuratorMessageAction } from "@/server/actions";
import { CommandForm } from "@/components/command-form";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/empty-state";
import { Button } from "@/components/ui/button";
import { fullName, formatDate } from "@/lib/utils";

export default async function AdminMessagesPage({
  searchParams,
}: {
  searchParams: Promise<{ studentId?: string }>;
}) {
  const session = await requireStaff();
  const { studentId } = await searchParams;
  const scope = studentScopeWhere(session.user.id, session.user.role);

  const portalConversations = await prisma.conversation.findMany({
    where: {
      channel: "PORTAL",
      student: {
        status: { notIn: ["ARCHIVED"] },
        AND: [scope],
      },
    },
    include: {
      student: { select: { id: true, firstName: true, lastName: true } },
      messages: { orderBy: { createdAt: "asc" }, take: 200 },
    },
    orderBy: { updatedAt: "desc" },
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

  for (const conversation of portalConversations) {
    if (!conversation.student) continue;
    const last = conversation.messages.at(-1);
    if (!last) continue;
    conversations.set(conversation.student.id, {
      studentId: conversation.student.id,
      name: fullName(
        conversation.student.firstName,
        conversation.student.lastName
      ),
      lastText: last.body?.trim() || "Вложение",
      lastAt: last.createdAt,
      unanswered: last.senderType === "STUDENT",
    });
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
    ? (
        portalConversations.find(
          (conversation) => conversation.studentId === selectedId
        )?.messages ?? []
      ).map((message) => ({
        id: message.id,
        text: message.body?.trim() || "",
        fromStudent: message.senderType === "STUDENT",
        author:
          message.senderType === "STUDENT"
            ? fullName(selected?.firstName ?? "", selected?.lastName ?? "")
            : "Куратор",
        createdAt: message.createdAt,
      }))
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
                <CommandForm
                  action={sendCuratorMessageAction}
                  operation="message.staff.send"
                  entityId={selected.id}
                  entityVersion={
                      portalConversations.find((c) => c.studentId === selected.id)
                        ?.version ?? 0
                    }
                  formInstance="compose"
                  className="space-y-2"
                >
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
                </CommandForm>
              </>
            ) : null}
          </div>
        </div>
      )}
    </div>
  );
}
