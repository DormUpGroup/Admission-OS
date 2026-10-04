import { requireStaff } from "@/server/auth/guards";
import { prisma } from "@/lib/db";
import { formatDate } from "@/lib/utils";
import { PageHeader } from "@/components/page-header";
import { LeadsTable } from "@/components/admin/leads-table";

export const dynamic = "force-dynamic";

const CHANNEL_LABELS: Record<string, string> = {
  TELEGRAM: "Telegram",
  EMAIL: "Почта",
  INSTAGRAM: "Instagram",
  SITE: "Сайт",
};

function leadTitle(input: {
  firstName: string | null;
  lastName: string | null;
  displayName: string | null;
  username: string | null;
}) {
  const name = [input.firstName, input.lastName].filter(Boolean).join(" ").trim();
  if (name) return name;
  if (input.displayName) return input.displayName;
  if (input.username) return `@${input.username.replace(/^@/, "")}`;
  return "Без имени";
}

function latestAt(dates: Array<Date | null | undefined>) {
  const stamps = dates.filter((date): date is Date => date instanceof Date);
  if (stamps.length === 0) return null;
  return new Date(Math.max(...stamps.map((date) => date.getTime())));
}

export default async function AdminLeadsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  await requireStaff();
  const { q } = await searchParams;
  const query = q?.trim() ?? "";

  const leads = await prisma.lead.findMany({
    where: {
      convertedStudentId: null,
      conversations: { some: {} },
      ...(query
        ? {
            OR: [
              { firstName: { contains: query, mode: "insensitive" } },
              { lastName: { contains: query, mode: "insensitive" } },
              { email: { contains: query, mode: "insensitive" } },
              { phone: { contains: query, mode: "insensitive" } },
              {
                channelIdentities: {
                  some: {
                    OR: [
                      { username: { contains: query, mode: "insensitive" } },
                      { displayName: { contains: query, mode: "insensitive" } },
                    ],
                  },
                },
              },
            ],
          }
        : {}),
    },
    include: {
      assignedCurator: { select: { name: true } },
      channelIdentities: {
        select: { channel: true, username: true, displayName: true },
        orderBy: { updatedAt: "desc" },
        take: 3,
      },
      conversations: {
        select: {
          id: true,
          channel: true,
          lastInboundAt: true,
          lastOutboundAt: true,
          updatedAt: true,
        },
        orderBy: { updatedAt: "desc" },
        take: 1,
      },
      appointments: {
        where: { guestEmail: { not: null } },
        select: { guestEmail: true },
        orderBy: { createdAt: "desc" },
        take: 1,
      },
    },
    orderBy: { updatedAt: "desc" },
    take: 200,
  });

  const rows = leads
    .map((lead) => {
      const conversation = lead.conversations[0] ?? null;
      const identity = lead.channelIdentities[0] ?? null;
      const channel = conversation?.channel ?? identity?.channel ?? lead.source;
      return {
        id: lead.id,
        title: leadTitle({
          firstName: lead.firstName,
          lastName: lead.lastName,
          displayName: identity?.displayName ?? null,
          username: identity?.username ?? null,
        }),
        channel: CHANNEL_LABELS[channel] ?? channel,
        contact:
          lead.email ||
          lead.appointments[0]?.guestEmail ||
          lead.phone ||
          (identity?.username ? `@${identity.username.replace(/^@/, "")}` : "—"),
        curator: lead.assignedCurator?.name ?? "Не назначен",
        activity: latestAt([
          conversation?.lastInboundAt,
          conversation?.lastOutboundAt,
          conversation?.updatedAt,
          lead.updatedAt,
        ]),
        conversationId: conversation?.id ?? null,
      };
    })
    .sort((a, b) => (b.activity?.getTime() ?? 0) - (a.activity?.getTime() ?? 0));

  return (
    <div className="space-y-4">
      <PageHeader
        title="Лиды"
        description="Переписка есть, учеником человек ещё не стал."
      />
      <form className="flex gap-2">
        <input
          name="q"
          defaultValue={query}
          placeholder="Имя, почта, телефон или Telegram"
          className="w-full max-w-sm rounded-xl border border-border bg-card px-3 py-2 text-[13px]"
        />
      </form>
      <LeadsTable
        query={query}
        rows={rows.map((row) => ({
          id: row.id,
          title: row.title,
          channel: row.channel,
          contact: row.contact,
          curator: row.curator,
          activity: formatDate(row.activity),
          conversationId: row.conversationId,
        }))}
      />
    </div>
  );
}
