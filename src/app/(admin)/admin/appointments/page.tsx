import { prisma } from "@/lib/db";
import { requireStaff } from "@/server/auth/guards";
import { PageHeader } from "@/components/page-header";
import { AppointmentsWorkspace } from "@/components/admin/appointments/workspace";
import type { CalendarView } from "@/components/admin/appointments/types";
import { isFixtureContact } from "@/lib/telegram-conversation-kind";
import {
  APPOINTMENT_TIMEZONE,
  dayRangeContaining,
  listOpenSlots,
  listSlotGrid,
  monthRangeContaining,
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

function dedupeByKey<T>(items: T[], keyFn: (item: T) => string): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const item of items) {
    const key = keyFn(item);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

function parseDateParam(raw: string | undefined): Date {
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

function parseView(raw: string | undefined): CalendarView {
  if (raw === "day" || raw === "month") return raw;
  return "week";
}

function ymdInRome(date: Date): string {
  const p = zonedParts(date, APPOINTMENT_TIMEZONE);
  return `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
}

function addDaysYmd(ymd: string, days: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  const probe = zonedWallTimeToUtc(y, m, d, 12, 0, APPOINTMENT_TIMEZONE);
  return ymdInRome(new Date(probe.getTime() + days * 24 * 60 * 60 * 1000));
}

function hrefFor(view: CalendarView, date: string) {
  return `/admin/appointments?view=${view}&date=${date}`;
}

function googleCalendarOpenUrl(calendarId: string | undefined): string | null {
  const id = calendarId?.trim();
  if (!id) return null;
  // Opens Google Calendar UI focused on this calendar when the user is signed in.
  return `https://calendar.google.com/calendar/u/0/r?cid=${encodeURIComponent(id)}`;
}

export default async function AdminAppointmentsPage({
  searchParams,
}: {
  searchParams: Promise<{ week?: string; date?: string; view?: string }>;
}) {
  const session = await requireStaff();
  const query = await searchParams;
  const view = parseView(query.view);
  // Support legacy ?week=
  const anchor = parseDateParam(query.date ?? query.week);
  const anchorYmd = ymdInRome(anchor);
  const curatorId = session.user.id;

  let from: Date;
  let to: Date;
  let gridDays: string[] = [];
  let rangeLabel = "";
  let monthMeta: { month: number; year: number } | null = null;
  let prevDate = anchorYmd;
  let nextDate = anchorYmd;

  if (view === "day") {
    ({ from, to } = dayRangeContaining(anchor));
    gridDays = [anchorYmd];
    rangeLabel = `${anchorYmd} · Europe/Rome`;
    prevDate = addDaysYmd(anchorYmd, -1);
    nextDate = addDaysYmd(anchorYmd, 1);
  } else if (view === "month") {
    const month = monthRangeContaining(anchor);
    from = month.from;
    to = month.to;
    monthMeta = { month: month.month, year: month.year };
    for (
      let t = from.getTime();
      t < to.getTime();
      t += 24 * 60 * 60 * 1000
    ) {
      gridDays.push(ymdInRome(new Date(t)));
    }
    rangeLabel = new Date(
      Date.UTC(month.year, month.month - 1, 1),
    ).toLocaleDateString("ru-RU", {
      month: "long",
      year: "numeric",
      timeZone: "UTC",
    });
    const prevMonthAnchor =
      month.month === 1
        ? zonedWallTimeToUtc(month.year - 1, 12, 15, 12, 0)
        : zonedWallTimeToUtc(month.year, month.month - 1, 15, 12, 0);
    const nextMonthAnchor =
      month.month === 12
        ? zonedWallTimeToUtc(month.year + 1, 1, 15, 12, 0)
        : zonedWallTimeToUtc(month.year, month.month + 1, 15, 12, 0);
    prevDate = ymdInRome(prevMonthAnchor);
    nextDate = ymdInRome(nextMonthAnchor);
  } else {
    ({ from, to } = weekRangeContaining(anchor));
    for (let i = 0; i < 5; i++) {
      gridDays.push(ymdInRome(new Date(from.getTime() + i * 24 * 60 * 60 * 1000)));
    }
    rangeLabel = `${gridDays[0]} — ${gridDays[4]} · Europe/Rome`;
    prevDate = addDaysYmd(gridDays[0], -7);
    nextDate = addDaysYmd(gridDays[0], 7);
  }

  const todayYmd = ymdInRome(new Date());
  const slotFrom = new Date();
  const slotTo = new Date(Date.now() + 21 * 24 * 60 * 60 * 1000);

  const [appointments, leads, students, conversations, openSlots, slotGrid] =
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
        take: 200,
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
        take: 200,
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
      listOpenSlots({ curatorId, from: slotFrom, to: slotTo }),
      listSlotGrid({ curatorId, from: slotFrom, to: slotTo }),
    ]);

  const leadOptions = sortByLabel(
    dedupeByKey(
      leads
        .map((l) => {
          const identity = l.channelIdentities[0];
          const username = identity?.username?.trim() || null;
          const displayName = identity?.displayName?.trim() || null;
          if (
            isFixtureContact({
              title:
                personLabel(l.firstName, l.lastName, "") || displayName || "",
              username,
            })
          ) {
            return null;
          }
          const base =
            personLabel(l.firstName, l.lastName, "") ||
            displayName ||
            `Клиент ${l.id.slice(0, 8)}`;
          return {
            id: l.id,
            label: username
              ? `${base} · @${username.replace(/^@/, "")}`
              : base,
            dedupeKey: (username ?? l.id).toLowerCase(),
          };
        })
        .filter((x): x is NonNullable<typeof x> => x != null),
      (x) => x.dedupeKey,
    ).map(({ id, label }) => ({ id, label })),
  );

  const studentOptions = sortByLabel(
    students.map((s) => ({
      id: s.id,
      label: `${s.firstName} ${s.lastName}`.trim(),
    })),
  );

  const conversationOptions = sortByLabel(
    dedupeByKey(
      conversations
        .map((c) => {
          const identity = c.lead?.channelIdentities[0];
          const username = identity?.username?.trim() || null;
          const displayName = identity?.displayName?.trim() || null;
          let base = "";
          if (c.student) {
            base = `${c.student.firstName} ${c.student.lastName}`.trim();
          } else if (c.lead) {
            base =
              personLabel(c.lead.firstName, c.lead.lastName, "") ||
              displayName ||
              "Чат";
          } else {
            base = displayName || "Чат";
          }
          if (isFixtureContact({ title: base, username })) return null;
          return {
            id: c.id,
            leadId: c.leadId,
            studentId: c.studentId,
            label: username
              ? `${base} · @${username.replace(/^@/, "")}`
              : base,
            dedupeKey: (
              c.leadId ||
              c.studentId ||
              username ||
              c.id
            ).toLowerCase(),
          };
        })
        .filter((x): x is NonNullable<typeof x> => x != null),
      (x) => x.dedupeKey,
    ).map(({ id, leadId, studentId, label }) => ({
      id,
      leadId,
      studentId,
      label,
    })),
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
        description="День / неделя / месяц · слоты 9:00–16:00 Rome · подтверждение в Telegram"
      />

      <AppointmentsWorkspace
        view={view}
        rangeLabel={rangeLabel}
        gridDays={gridDays}
        monthMeta={monthMeta}
        prevHref={hrefFor(view, prevDate)}
        nextHref={hrefFor(view, nextDate)}
        todayHref={hrefFor(view, todayYmd)}
        viewHrefs={{
          day: hrefFor("day", anchorYmd),
          week: hrefFor("week", anchorYmd),
          month: hrefFor("month", anchorYmd),
        }}
        appointments={calendarAppointments}
        openSlots={openSlots.map((s) => ({
          key: s.key,
          startsAt: s.startsAt.toISOString(),
          endsAt: s.endsAt.toISOString(),
        }))}
        slotGrid={slotGrid.map((s) => ({
          key: s.key,
          startsAt: s.startsAt.toISOString(),
          endsAt: s.endsAt.toISOString(),
          status: s.status,
          busyLabel: s.busyLabel,
        }))}
        leads={leadOptions}
        students={studentOptions}
        conversations={conversationOptions}
        googleCalendarUrl={googleCalendarOpenUrl(
          process.env.GOOGLE_CALENDAR_ID,
        )}
      />
    </div>
  );
}
