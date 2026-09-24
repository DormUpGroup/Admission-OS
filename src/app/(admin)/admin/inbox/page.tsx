import Link from "next/link";
import { prisma } from "@/lib/db";
import { requireStaff } from "@/server/auth/guards";
import { sendTelegramInboxReplyAction } from "@/server/inbox-actions";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/empty-state";
import { Button } from "@/components/ui/button";
import { formatDate } from "@/lib/utils";

function conversationTitle(c: {
  id: string;
  lead?: { id: string; firstName: string | null; lastName: string | null } | null;
  student?: { firstName: string; lastName: string } | null;
}) {
  if (c.lead) {
    const name = [c.lead.firstName, c.lead.lastName].filter(Boolean).join(" ");
    return name || `Lead ${c.lead.id.slice(0, 8)}`;
  }
  if (c.student) {
    return `${c.student.firstName} ${c.student.lastName}`;
  }
  return c.id.slice(0, 8);
}

function deliveryBadgeClass(status: string) {
  switch (status) {
    case "SENT":
    case "RECEIVED":
      return "bg-emerald-50 text-emerald-800";
    case "PENDING":
    case "PROCESSING":
      return "bg-amber-50 text-amber-900";
    case "UNKNOWN_REQUIRES_REVIEW":
      return "bg-orange-50 text-orange-900";
    case "FAILED":
      return "bg-red-50 text-red-800";
    default:
      return "bg-muted text-muted-foreground";
  }
}

export default async function AdminInboxPage({
  searchParams,
}: {
  searchParams: Promise<{ conversationId?: string }>;
}) {
  await requireStaff();
  const { conversationId } = await searchParams;

  const conversations = await prisma.conversation.findMany({
    where: { channel: "TELEGRAM" },
    include: {
      lead: { select: { id: true, firstName: true, lastName: true } },
      student: { select: { id: true, firstName: true, lastName: true } },
      messages: {
        orderBy: { createdAt: "desc" },
        take: 1,
      },
    },
    orderBy: [{ lastInboundAt: "desc" }, { updatedAt: "desc" }],
    take: 50,
  });

  const activeId = conversationId ?? conversations[0]?.id ?? null;
  const active = activeId
    ? await prisma.conversation.findUnique({
        where: { id: activeId },
        include: {
          lead: true,
          student: { select: { id: true, firstName: true, lastName: true } },
          messages: {
            orderBy: { createdAt: "asc" },
            take: 100,
            include: {
              deliveryAttempts: {
                orderBy: { attempt: "desc" },
                take: 1,
              },
            },
          },
        },
      })
    : null;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Telegram inbox"
        description="Входящие из бота и исходящие через outbox (delivery status)"
      />

      {conversations.length === 0 ? (
        <EmptyState
          title="Пока нет Telegram-диалогов"
          description="Как только webhook примет сообщение, разговор появится здесь."
        />
      ) : (
        <div className="grid gap-4 lg:grid-cols-[280px_1fr]">
          <aside className="space-y-1 rounded-lg border border-black/5 bg-white p-2">
            {conversations.map((c) => {
              const last = c.messages[0];
              const selected = c.id === activeId;
              return (
                <Link
                  key={c.id}
                  href={`/admin/inbox?conversationId=${c.id}`}
                  className={`block rounded-md px-3 py-2 text-sm ${
                    selected ? "bg-[var(--brand)]/10 text-foreground" : "hover:bg-muted/60"
                  }`}
                >
                  <div className="font-medium">{conversationTitle(c)}</div>
                  <div className="truncate text-[12px] text-muted-foreground">
                    {last?.body || "—"}
                  </div>
                  {last ? (
                    <span
                      className={`mt-1 inline-block rounded px-1.5 py-0.5 text-[10px] font-medium ${deliveryBadgeClass(last.deliveryStatus)}`}
                    >
                      {last.deliveryStatus}
                    </span>
                  ) : null}
                </Link>
              );
            })}
          </aside>

          <section className="rounded-lg border border-black/5 bg-white p-4">
            {!active ? (
              <p className="text-sm text-muted-foreground">Выберите разговор</p>
            ) : (
              <>
                <div className="mb-4 flex items-baseline justify-between gap-2 border-b border-black/5 pb-3">
                  <div>
                    <h2 className="text-base font-semibold">{conversationTitle(active)}</h2>
                    <p className="text-[12px] text-muted-foreground">
                      {active.id}
                      {active.automationPausedAt ? " · automation paused" : ""}
                    </p>
                  </div>
                </div>

                <div className="mb-4 max-h-[480px] space-y-3 overflow-y-auto">
                  {active.messages.map((m) => (
                    <div
                      key={m.id}
                      className={`rounded-md px-3 py-2 text-sm ${
                        m.direction === "INBOUND"
                          ? "bg-muted/50"
                          : "bg-[var(--brand)]/5"
                      }`}
                    >
                      <div className="mb-1 flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
                        <span>{m.direction}</span>
                        <span>·</span>
                        <span>{formatDate(m.createdAt)}</span>
                        <span
                          className={`rounded px-1.5 py-0.5 font-medium ${deliveryBadgeClass(m.deliveryStatus)}`}
                        >
                          {m.deliveryStatus}
                        </span>
                      </div>
                      <p className="whitespace-pre-wrap">{m.body || "(empty)"}</p>
                    </div>
                  ))}
                </div>

                <form action={sendTelegramInboxReplyAction} className="space-y-2 border-t border-black/5 pt-3">
                  <input type="hidden" name="conversationId" value={active.id} />
                  <textarea
                    name="body"
                    rows={3}
                    required
                    placeholder="Ответ в Telegram…"
                    className="w-full rounded-md border border-black/10 bg-white px-3 py-2 text-sm"
                  />
                  <Button type="submit" size="sm">
                    Отправить через outbox
                  </Button>
                  <p className="text-[11px] text-muted-foreground">
                    Требуется AUTOMATION_ENABLED=true на worker и TELEGRAM_BOT_TOKEN.
                  </p>
                </form>
              </>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
