import { prisma } from "@/lib/db";
import { requireStaff } from "@/server/auth/guards";
import { PageHeader } from "@/components/page-header";
import { AppointmentsWorkspace } from "@/components/admin/appointments/workspace";
import {
  APPOINTMENT_TIMEZONE,
  listOpenSlots,
  weekRangeContaining,
  zonedParts,
  zonedWallTimeToUtc,
} from "@/server/services/appointments/slots";

function personLabel(
  firstName: string | null | undefined,
  lastName: string | null | undefined,
  fallback: string,
) {
  const name = [firstName, lastName].filter(Boolean).join(" ").trim();
  return name || fallback;
}

function sortByLabel<T extends { label: string }>(items: T[]): T[] {
  return [...items].sort((a, b) =>
    a.label.localeCompare(b.label, "ru", { sensitivity: "base" }),
  );
}

function parseWeekParam(raw: string | undefined): Date {
  if (!raw) return new Date();
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw);
  if (!m) return new Date();
  return zonedWallTimeToUtc(
    Number(m[1]),
    Number(m[2]),
    Number(m[3]),
    12,
    0,
    APPOINTMENT_TIMEZONE,
  );
}

function ymdInRome(date: Date): string {
  const p = zonedParts(date, APPOINTMENT_TIMEZONE);
  return `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
}

export default async function AdminAppointmentsPage({
  searchParams,
}: {
  searchParams: Promise<{ week?: string }>;
}) {
  const session = await requireStaff();
  const query = await searchParams;
  const anchor = parseWeekParam(query.week);
  const { from, to } = weekRangeContaining(anchor, APPOINTMENT_TIMEZONE);
  const curatorId = session.user.id;

  const weekDays: string[] = [];
  for (let i = 0; i < 5; i++) {
    const day = new Date(from.getTime() + i * 24 * 60 * 60 * 1000);
    weekDays.push(ymdInRome(day));
  }

  const prevWeek = ymdInRome(new Date(from.getTime() - 7 * 24 * 60 * 60 * 1000));
  const nextWeek = ymdInRome(new Date(from.getTime() + 7 * 24 * 60 * 60 * 1000));
  const weekLabel = `${weekDays[0]} — ${weekDays[4]} · Europe/Rome`;

  const openSlotsPromise = listOpenSlots({
    curatorId,
    from: new Date(),
    to: new Date(Date.now() + 21 * 24 * 60 * 60 * 1000),
  });

  const [appointments, leads, students, conversations, openSlots] =
    await Promise.all([
      prisma.appointment.findMany({
        where: {
          assignedCuratorId: curatorId,
          status: { not: "CANCELLED" },
          OR: [
            { startsAt: { gte: from, lt: to } },
            { pendingStartsAt: { gte: from, lt: to } },
          ],
        },
        include: {
          lead: { select: { id: true, firstName: true, lastName: true } },
          student: { select: { id: true, firstName: true, lastName: true } },
          conversation: { select: { id: true, channel: true } },
        },
        orderBy: { startsAt: "asc" },
      }),
      prisma.lead.findMany({
        orderBy: { createdAt: "desc" },
        take: 80,
        select: {
          id: true,
          firstName: true,
          lastName: true,
          channelIdentities: {
            where: { channel: "TELEGRAM" },
            select: { username: true, displayName: true },
            take: 1,
          },
        },
      }),
      prisma.student.findMany({
        where: { status: { notIn: ["ARCHIVED"] } },
        orderBy: { updatedAt: "desc" },
        take: 80,
        select: { id: true, firstName: true, lastName: true },
      }),
      prisma.conversation.findMany({
        where: { channel: "TELEGRAM", status: "OPEN" },
        orderBy: { updatedAt: "desc" },
        take: 80,
        select: {
          id: true,
          leadId: true,
          studentId: true,
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
      }),
      openSlotsPromise,
    ]);

  const leadOptions = sortByLabel(
    leads.map((l) => {
      const identity = l.channelIdentities[0];
      const base =
        personLabel(l.firstName, l.lastName, "") ||
        identity?.displayName?.trim() ||
        `Клиент ${l.id.slice(0, 8)}`;
      const username = identity?.username?.trim();
      return {
        id: l.id,
        label: username ? `${base} · @${username.replace(/^@/, "")}` : base,
      };
    }),
  );

  const studentOptions = sortByLabel(
    students.map((s) => ({
      id: s.id,
      label: `${s.firstName} ${s.lastName}`.trim(),
    })),
  );

  const conversationOptions = sortByLabel(
    conversations.map((c) => {
      const identity = c.lead?.channelIdentities[0];
      let base = "";
      if (c.student) {
        base = `${c.student.firstName} ${c.student.lastName}`.trim();
      } else if (c.lead) {
        base =
          personLabel(c.lead.firstName, c.lead.lastName, "") ||
          identity?.displayName?.trim() ||
          "Чат";
      } else {
        base = identity?.displayName?.trim() || "Чат";
      }
      const username = identity?.username?.trim();
      return {
        id: c.id,
        leadId: c.leadId,
        studentId: c.studentId,
        label: username ? `${base} · @${username.replace(/^@/, "")}` : base,
      };
    }),
  );

  const calendarAppointments = appointments.map((a) => {
    let subjectLabel = "—";
    if (a.lead) {
      subjectLabel = personLabel(
        a.lead.firstName,
        a.lead.lastName,
        `Клиент ${a.lead.id.slice(0, 8)}`,
      );
    } else if (a.student) {
      subjectLabel = `${a.student.firstName} ${a.student.lastName}`;
    }
    return {
      id: a.id,
      title: a.title,
      status: a.status,
      startsAt: a.startsAt.toISOString(),
      endsAt: a.endsAt.toISOString(),
      pendingStartsAt: a.pendingStartsAt?.toISOString() ?? null,
      pendingEndsAt: a.pendingEndsAt?.toISOString() ?? null,
      subjectLabel,
      hasTelegram: a.conversation?.channel === "TELEGRAM",
      googleEventId: a.googleEventId,
    };
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title="Консультации"
        description="Недельная сетка · слоты 9:00–16:00 Rome · подтверждение в Telegram"
      />

      <AppointmentsWorkspace
        weekLabel={weekLabel}
        weekDays={weekDays}
        prevWeekHref={`/admin/appointments?week=${prevWeek}`}
        nextWeekHref={`/admin/appointments?week=${nextWeek}`}
        appointments={calendarAppointments}
        openSlots={openSlots.map((s) => ({
          key: s.key,
          startsAt: s.startsAt.toISOString(),
          endsAt: s.endsAt.toISOString(),
        }))}
        leads={leadOptions}
        students={studentOptions}
        conversations={conversationOptions}
      />
    </div>
  );
}
