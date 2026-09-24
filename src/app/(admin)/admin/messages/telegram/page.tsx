import Link from "next/link";
import { prisma } from "@/lib/db";
import { requireStaff } from "@/server/auth/guards";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/empty-state";
import { AdminInboxReplyForm } from "@/components/admin-inbox-reply-form";
import { formatDate } from "@/lib/utils";

function conversationTitle(c: {
  id: string;
  lead?: { id: string; firstName: string | null; lastName: string | null } | null;
  student?: { firstName: string; lastName: string } | null;
}) {
  if (c.lead) {
    const name = [c.lead.firstName, c.lead.lastName].filter(Boolean).join(" ");
    return name || `Клиент ${c.lead.id.slice(0, 8)}`;
  }
  if (c.student) {
    return `${c.student.firstName} ${c.student.lastName}`;
  }
  return `Чат ${c.id.slice(0, 8)}`;
}

function deliveryLabel(status: string, direction: string): string | null {
  if (direction === "INBOUND") {
    if (status === "RECEIVED") return null;
    return status;
  }
  switch (status) {
    case "SENT":
    case "SUCCESS":
      return "Отправлено";
    case "PENDING":
    case "PROCESSING":
      return "Отправляется…";
    case "FAILED":
      return "Не доставлено";
    case "UNKNOWN_REQUIRES_REVIEW":
      return "Проверьте доставку";
    default:
      return status;
  }
}

function deliveryBadgeClass(status: string) {
  switch (status) {
    case "SENT":
    case "SUCCESS":
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

function isUndeliveredOutbound(status: string) {
  return (
    status === "PENDING" ||
    status === "PROCESSING" ||
    status === "FAILED" ||
    status === "UNKNOWN_REQUIRES_REVIEW"
  );
}

export default async function AdminTelegramMessagesPage({
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

  const hasPendingDelivery =
    active?.messages.some(
      (m) =>
        m.direction === "OUTBOUND" &&
        (m.deliveryStatus === "PENDING" || m.deliveryStatus === "PROCESSING"),
    ) ?? false;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Чаты Telegram"
        description="Переписка с клиентами Immigrome"
      />

      {conversations.length === 0 ? (
        <EmptyState
          title="Пока нет диалогов"
          description="Как только клиент напишет боту, разговор появится здесь."
        />
      ) : (
        <div className="grid gap-4 lg:grid-cols-[280px_1fr]">
          <aside className="space-y-1 rounded-lg border border-black/5 bg-white p-2">
            {conversations.map((c) => {
              const last = c.messages[0];
              const selected = c.id === activeId;
              const showWarn =
                last?.direction === "OUTBOUND" &&
                isUndeliveredOutbound(last.deliveryStatus);
              return (
                <Link
                  key={c.id}
                  href={`/admin/messages/telegram?conversationId=${c.id}`}
                  className={`block rounded-md px-3 py-2 text-sm ${
                    selected
                      ? "bg-[var(--brand)]/10 text-foreground"
                      : "hover:bg-muted/60"
                  }`}
                >
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="font-medium">{conversationTitle(c)}</span>
                    {last ? (
                      <span className="shrink-0 text-[11px] text-muted-foreground">
                        {formatDate(last.createdAt)}
                      </span>
                    ) : null}
                  </div>
                  <div className="truncate text-[12px] text-muted-foreground">
                    {last?.body || "—"}
                  </div>
                  {showWarn ? (
                    <span
                      className={`mt-1 inline-block rounded px-1.5 py-0.5 text-[10px] font-medium ${deliveryBadgeClass(last!.deliveryStatus)}`}
                    >
                      {deliveryLabel(last!.deliveryStatus, "OUTBOUND")}
                    </span>
                  ) : null}
                </Link>
              );
            })}
          </aside>

          <section className="flex min-h-[520px] flex-col rounded-lg border border-black/5 bg-white p-4">
            {!active ? (
              <p className="text-sm text-muted-foreground">Выберите диалог</p>
            ) : (
              <>
                <div className="mb-4 border-b border-black/5 pb-3">
                  <h2 className="text-base font-semibold">
                    {conversationTitle(active)}
                  </h2>
                  <p className="text-[12px] text-muted-foreground">
                    Telegram
                    {active.automationPausedAt
                      ? " · автоответы на паузе"
                      : ""}
                  </p>
                </div>

                <div className="mb-4 flex-1 space-y-2 overflow-y-auto">
                  {active.messages.map((m) => {
                    const outbound = m.direction === "OUTBOUND";
                    const label = deliveryLabel(m.deliveryStatus, m.direction);
                    const attemptError =
                      outbound &&
                      (m.deliveryStatus === "FAILED" ||
                        m.deliveryStatus === "UNKNOWN_REQUIRES_REVIEW")
                        ? m.deliveryAttempts[0]?.errorMessage
                        : null;
                    return (
                      <div
                        key={m.id}
                        className={`flex ${outbound ? "justify-end" : "justify-start"}`}
                      >
                        <div
                          className={`max-w-[85%] rounded-2xl px-3 py-2 text-sm ${
                            outbound
                              ? "rounded-br-md bg-[var(--brand)]/10"
                              : "rounded-bl-md bg-muted/60"
                          }`}
                        >
                          <div className="mb-1 flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
                            <span className="font-medium text-foreground/70">
                              {outbound ? "Вы" : "Клиент"}
                            </span>
                            <span>·</span>
                            <span>{formatDate(m.createdAt)}</span>
                            {label ? (
                              <span
                                className={`rounded px-1.5 py-0.5 font-medium ${deliveryBadgeClass(m.deliveryStatus)}`}
                              >
                                {label}
                              </span>
                            ) : null}
                          </div>
                          <p className="whitespace-pre-wrap">
                            {m.body || "—"}
                          </p>
                          {attemptError ? (
                            <p className="mt-1 text-[11px] text-red-700">
                              {attemptError}
                            </p>
                          ) : null}
                        </div>
                      </div>
                    );
                  })}
                </div>

                <AdminInboxReplyForm
                  conversationId={active.id}
                  hasPendingDelivery={hasPendingDelivery}
                />
              </>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
