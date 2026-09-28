import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { requireStaff } from "@/server/auth/guards";
import { prisma } from "@/lib/db";
import { formatDate } from "@/lib/utils";
import { isLeadProfileMessage, readLeadFacts } from "@/lib/lead-profile";
import { PageHeader } from "@/components/page-header";
import { StudentAvatar } from "@/components/student-avatar";
import { PromoteLeadButton } from "@/components/admin/promote-lead-button";

export const dynamic = "force-dynamic";

const CHANNEL_LABELS: Record<string, string> = {
  TELEGRAM: "Telegram",
  EMAIL: "Почта",
  INSTAGRAM: "Instagram",
  SITE: "Сайт",
};

const CONSENT_LABELS: Record<string, string> = {
  UNKNOWN: "Не спрашивали",
  GRANTED: "Есть",
  DENIED: "Отказано",
};

const APPOINTMENT_LABELS: Record<string, string> = {
  PENDING: "Ожидает",
  CONFIRMED: "Подтверждена",
  CANCELLED: "Отменена",
};

function formatWhen(date: Date) {
  return date.toLocaleString("ru-RU", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default async function LeadProfilePage({
  params,
}: {
  params: Promise<{ leadId: string }>;
}) {
  await requireStaff();
  const { leadId } = await params;
  const lead = await prisma.lead.findUnique({
    where: { id: leadId },
    include: {
      assignedCurator: { select: { name: true } },
      channelIdentities: {
        select: { channel: true, username: true, displayName: true },
        orderBy: { updatedAt: "desc" },
      },
      appointments: {
        select: { id: true, title: true, startsAt: true, status: true },
        orderBy: { startsAt: "desc" },
        take: 8,
      },
      conversations: {
        select: {
          id: true,
          channel: true,
          lastInboundAt: true,
          updatedAt: true,
          messages: {
            select: { id: true, direction: true, body: true, createdAt: true },
            orderBy: { createdAt: "asc" },
            take: 500,
          },
          _count: { select: { messages: true } },
        },
        orderBy: { updatedAt: "desc" },
      },
    },
  });
  if (!lead) notFound();
  if (lead.convertedStudentId) redirect(`/admin/students/${lead.convertedStudentId}`);

  const identity = lead.channelIdentities[0] ?? null;
  const name =
    [lead.firstName, lead.lastName].filter(Boolean).join(" ").trim() ||
    identity?.displayName?.trim() ||
    "Без имени";
  const username = identity?.username?.replace(/^@/, "") ?? null;
  const facts = readLeadFacts(lead.qualificationJson);
  const primaryChat =
    lead.conversations.find((conversation) => conversation.channel === "TELEGRAM") ??
    lead.conversations[0] ??
    null;

  const threads = lead.conversations.map((conversation) => {
    const turns = conversation.messages.filter((message) => isLeadProfileMessage(message.body));
    return {
      id: conversation.id,
      channel: CHANNEL_LABELS[conversation.channel] ?? conversation.channel,
      chatHref:
        conversation.channel === "TELEGRAM"
          ? `/admin/messages/telegram?conversationId=${conversation.id}`
          : null,
      truncated: conversation._count.messages > conversation.messages.length,
      turns,
    };
  });
  const hasTurns = threads.some((thread) => thread.turns.length > 0);

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <Link href="/admin/leads" className="text-[13px] text-muted-foreground hover:underline">
        ← Лиды
      </Link>
      <PageHeader
        title={name}
        description="Лид. Здесь контакты и всё, что человек написал в переписке."
        actions={
          <>
            {primaryChat?.channel === "TELEGRAM" ? (
              <Link
                href={`/admin/messages/telegram?conversationId=${primaryChat.id}`}
                className="rounded-full border border-border px-4 py-2 text-[13px]"
              >
                Открыть чат
              </Link>
            ) : null}
            {primaryChat ? <PromoteLeadButton conversationId={primaryChat.id} /> : null}
          </>
        }
      >
        <div className="flex items-center gap-3">
          <StudentAvatar name={name} size="lg" />
          <p className="text-[13px] text-muted-foreground">
            {username ? `@${username}` : "Telegram без username"}
            {" · "}
            куратор {lead.assignedCurator?.name ?? "не назначен"}
          </p>
        </div>
      </PageHeader>

      <div className="grid gap-4 md:grid-cols-2">
        <section className="rounded-2xl border border-border bg-card px-4 py-3">
          <h2 className="mb-2 text-[13px] font-medium">Контакты</h2>
          <dl className="space-y-2 text-[14px]">
            <Fact label="Telegram" value={username ? `@${username}` : "—"} />
            {lead.email ? <Fact label="Почта" value={lead.email} /> : null}
            {lead.phone ? <Fact label="Телефон" value={lead.phone} /> : null}
            <Fact label="Язык" value={lead.locale?.trim() || "—"} />
            <Fact label="Согласие" value={CONSENT_LABELS[lead.consentStatus] ?? lead.consentStatus} />
            <Fact label="Куратор" value={lead.assignedCurator?.name ?? "Не назначен"} />
            <Fact label="В базе с" value={formatDate(lead.createdAt)} />
          </dl>
        </section>

        <section className="rounded-2xl border border-border bg-card px-4 py-3">
          <h2 className="mb-2 text-[13px] font-medium">Записано из переписки</h2>
          {facts.length === 0 ? (
            <p className="text-[14px] text-muted-foreground">
              Отдельные поля ещё не сохранены. Ниже полный текст переписки.
            </p>
          ) : (
            <dl className="space-y-2 text-[14px]">
              {facts.map((fact) => (
                <Fact key={fact.key} label={fact.label} value={fact.value} />
              ))}
            </dl>
          )}
        </section>
      </div>

      {lead.appointments.length > 0 ? (
        <section className="rounded-2xl border border-border bg-card px-4 py-3">
          <h2 className="mb-2 text-[13px] font-medium">Встречи</h2>
          <ul className="space-y-2 text-[14px]">
            {lead.appointments.map((appointment) => (
              <li key={appointment.id} className="flex justify-between gap-4">
                <span>{appointment.title}</span>
                <span className="text-right text-muted-foreground">
                  {formatWhen(appointment.startsAt)}
                  {" · "}
                  {APPOINTMENT_LABELS[appointment.status] ?? appointment.status}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className="space-y-3">
        <h2 className="text-[13px] font-medium">Переписка</h2>
        {!hasTurns ? (
          <p className="rounded-2xl border border-border bg-card px-4 py-3 text-[14px] text-muted-foreground">
            В переписке пока нет сообщений с информацией о человеке.
          </p>
        ) : (
          threads.map((thread) =>
            thread.turns.length === 0 ? null : (
              <div key={thread.id} className="rounded-2xl border border-border bg-card">
                <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-2">
                  <p className="text-[13px] font-medium">{thread.channel}</p>
                  {thread.chatHref ? (
                    <Link href={thread.chatHref} className="text-[12px] text-[var(--brand)] hover:underline">
                      Открыть чат
                    </Link>
                  ) : null}
                </div>
                <ol className="divide-y divide-border">
                  {thread.turns.map((turn) => {
                    const outbound = turn.direction === "OUTBOUND";
                    return (
                      <li key={turn.id} className={outbound ? "bg-muted/40 px-4 py-3" : "px-4 py-3"}>
                        <p className="text-[11px] text-muted-foreground">
                          {outbound ? "Мы" : name}
                          {" · "}
                          {formatWhen(turn.createdAt)}
                        </p>
                        <p className="mt-1 whitespace-pre-wrap text-[14px] leading-relaxed">{turn.body}</p>
                      </li>
                    );
                  })}
                </ol>
                {thread.truncated ? (
                  <p className="border-t border-border px-4 py-2 text-[12px] text-muted-foreground">
                    Показаны первые 500 сообщений. Остальное в чате.
                  </p>
                ) : null}
              </div>
            ),
          )
        )}
      </section>
    </div>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-4">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="text-right">{value}</dd>
    </div>
  );
}
