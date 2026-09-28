import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { requireStaff } from "@/server/auth/guards";
import { prisma } from "@/lib/db";
import { PageHeader } from "@/components/page-header";
import { PromoteLeadButton } from "@/components/admin/promote-lead-button";

export const dynamic = "force-dynamic";

const FACTS: Array<{ key: string; label: string }> = [
  { key: "educationLevel", label: "Образование" },
  { key: "studyLevel", label: "Уровень" },
  { key: "targetField", label: "Направление" },
  { key: "desiredIntake", label: "Набор" },
  { key: "preferredCountry", label: "Страна" },
  { key: "budget", label: "Бюджет" },
];

function factText(value: unknown, key: string): string | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const raw = (value as Record<string, unknown>)[key];
  if (typeof raw !== "string") return null;
  const text = raw.trim();
  return text || null;
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
      channelIdentities: {
        where: { channel: "TELEGRAM" },
        select: { username: true, displayName: true },
        orderBy: { updatedAt: "desc" },
        take: 1,
      },
      conversations: {
        where: { channel: "TELEGRAM" },
        select: { id: true },
        orderBy: { updatedAt: "desc" },
        take: 1,
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
  const chat = lead.conversations[0] ?? null;
  const facts = FACTS.map((fact) => ({
    label: fact.label,
    value: factText(lead.qualificationJson, fact.key),
  })).filter((fact) => fact.value);

  return (
    <div className="mx-auto max-w-lg space-y-4">
      <PageHeader
        title={name}
        description="Лид. Карточка собрана из переписки. Учеником назначает куратор или админ."
      />
      <dl className="space-y-2 rounded-2xl border border-border bg-card px-4 py-3 text-[14px]">
        <div className="flex justify-between gap-4">
          <dt className="text-muted-foreground">Статус</dt>
          <dd>Лид</dd>
        </div>
        <div className="flex justify-between gap-4">
          <dt className="text-muted-foreground">Telegram</dt>
          <dd>{username ? `@${username}` : "—"}</dd>
        </div>
        {facts.map((fact) => (
          <div key={fact.label} className="flex justify-between gap-4">
            <dt className="text-muted-foreground">{fact.label}</dt>
            <dd className="text-right">{fact.value}</dd>
          </div>
        ))}
        {facts.length === 0 ? (
          <p className="text-muted-foreground">Из переписки пока ничего не сохранено.</p>
        ) : null}
      </dl>
      <div className="flex flex-wrap gap-2">
        {chat ? (
          <Link
            href={`/admin/messages/telegram?conversationId=${chat.id}`}
            className="rounded-full border border-border px-4 py-2 text-[13px]"
          >
            Открыть чат
          </Link>
        ) : null}
        {chat ? <PromoteLeadButton conversationId={chat.id} /> : null}
      </div>
    </div>
  );
}
