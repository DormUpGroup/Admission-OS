import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { requireStaff } from "@/server/auth/guards";
import { prisma } from "@/lib/db";
import { formatDate } from "@/lib/utils";
import { buildLeadCard } from "@/lib/lead-profile";
import { PageHeader } from "@/components/page-header";
import { StudentAvatar } from "@/components/student-avatar";
import { PromoteLeadButton } from "@/components/admin/promote-lead-button";
import { DeleteLeadButton } from "@/components/admin/delete-lead-button";
import { PlatformPresenceBadge } from "@/components/platform-presence-badge";

export const dynamic = "force-dynamic";

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
        select: { id: true, title: true, startsAt: true, status: true, guestEmail: true },
        orderBy: { startsAt: "desc" },
        take: 8,
      },
      conversations: {
        select: {
          id: true,
          channel: true,
          messages: {
            select: { direction: true, body: true, createdAt: true },
            orderBy: { createdAt: "asc" },
            take: 500,
          },
        },
        orderBy: { updatedAt: "asc" },
      },
    },
  });
  if (!lead) notFound();
  if (lead.convertedStudentId) redirect(`/admin/students/${lead.convertedStudentId}`);

  const bookedEmail =
    lead.appointments
      .filter((appointment) => appointment.status !== "CANCELLED")
      .map((appointment) => appointment.guestEmail?.trim().toLowerCase() || null)
      .find((value): value is string => Boolean(value)) ??
    lead.appointments
      .map((appointment) => appointment.guestEmail?.trim().toLowerCase() || null)
      .find((value): value is string => Boolean(value)) ??
    null;
  const email = lead.email?.trim().toLowerCase() || bookedEmail;
  if (email && email !== lead.email?.trim().toLowerCase()) {
    await prisma.lead.update({ where: { id: lead.id }, data: { email } });
  }

  const identity = lead.channelIdentities[0] ?? null;
  const name =
    [lead.firstName, lead.lastName].filter(Boolean).join(" ").trim() ||
    identity?.displayName?.trim() ||
    "Без имени";
  const username = identity?.username?.replace(/^@/, "") ?? null;
  const primaryChat =
    lead.conversations.find((conversation) => conversation.channel === "TELEGRAM") ??
    lead.conversations[0] ??
    null;
  const facts = buildLeadCard({
    qualificationJson: lead.qualificationJson,
    messages: [...lead.conversations]
      .sort(
        (a, b) =>
          (a.messages[0]?.createdAt.getTime() ?? 0) - (b.messages[0]?.createdAt.getTime() ?? 0),
      )
      .flatMap((conversation) => conversation.messages),
  });

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <Link href="/admin/leads" className="text-[13px] text-muted-foreground hover:underline">
        ← Лиды
      </Link>
      <PageHeader
        title={name}
        description="Коротко из переписки: куда хочет поступать и что уже известно."
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
            <DeleteLeadButton leadId={lead.id} name={name} />
          </>
        }
      >
        <div className="flex items-center gap-3">
          <StudentAvatar name={name} size="lg" />
          <div className="space-y-1">
            <PlatformPresenceBadge hasAccount={false} />
            <p className="text-[13px] text-muted-foreground">
              {username ? `@${username}` : "Telegram без username"}
              {" · "}
              куратор {lead.assignedCurator?.name ?? "не назначен"}
            </p>
          </div>
        </div>
      </PageHeader>

      <div className="grid gap-4 md:grid-cols-2">
        <section className="rounded-2xl border border-border bg-card px-4 py-3">
          <h2 className="mb-2 text-[13px] font-medium">Контакты</h2>
          <dl className="space-y-2 text-[14px]">
            <Fact label="Telegram" value={username ? `@${username}` : "—"} />
            {email ? <Fact label="Почта" value={email} /> : null}
            {lead.phone ? <Fact label="Телефон" value={lead.phone} /> : null}
            {lead.locale?.trim() ? <Fact label="Локаль" value={lead.locale.trim()} /> : null}
            <Fact label="Согласие" value={CONSENT_LABELS[lead.consentStatus] ?? lead.consentStatus} />
            <Fact label="Куратор" value={lead.assignedCurator?.name ?? "Не назначен"} />
            <Fact label="В базе с" value={formatDate(lead.createdAt)} />
          </dl>
        </section>

        <section className="rounded-2xl border border-border bg-card px-4 py-3">
          <h2 className="mb-2 text-[13px] font-medium">Карточка лида</h2>
          {facts.length === 0 ? (
            <p className="text-[14px] text-muted-foreground">
              В переписке пока нет фактов для карточки.
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
