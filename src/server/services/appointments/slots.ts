import { prisma } from "@/lib/db";
import {
  APPOINTMENT_DURATION_MINUTES,
  APPOINTMENT_TIMEZONE,
  SLOT_DAY_END_HOUR,
  SLOT_DAY_START_HOUR,
  SLOT_STEP_MINUTES,
} from "@/lib/appointment-slots";

export {
  APPOINTMENT_DURATION_MINUTES,
  APPOINTMENT_TIMEZONE,
  SLOT_DAY_END_HOUR,
  SLOT_DAY_START_HOUR,
  SLOT_STEP_MINUTES,
};

export type AppointmentSlot = {
  startsAt: Date;
  endsAt: Date;
  /** Compact key for Telegram callback_data, e.g. 20260926T0900 */
  key: string;
};

const ACTIVE_STATUSES = ["AWAITING_CLIENT", "PENDING", "CONFIRMED"] as const;

function pad2(n: number) {
  return String(n).padStart(2, "0");
}

/** Local calendar parts for an instant in a given IANA timezone. */
export function zonedParts(
  date: Date,
  timeZone: string = APPOINTMENT_TIMEZONE,
): {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  weekday: number; // 1=Mon … 7=Sun (ISO)
} {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    weekday: "short",
    hourCycle: "h23",
  }).formatToParts(date);

  const get = (type: string) =>
    parts.find((p) => p.type === type)?.value ?? "";

  const weekdayMap: Record<string, number> = {
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
    Sun: 7,
  };

  return {
    year: Number(get("year")),
    month: Number(get("month")),
    day: Number(get("day")),
    hour: Number(get("hour")),
    minute: Number(get("minute")),
    weekday: weekdayMap[get("weekday")] ?? 0,
  };
}

/**
 * Build a UTC Date for a wall-clock time in `timeZone`.
 * Iteratively corrects for DST by comparing formatted local parts.
 */
export function zonedWallTimeToUtc(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  timeZone: string = APPOINTMENT_TIMEZONE,
): Date {
  let utc = new Date(Date.UTC(year, month - 1, day, hour, minute, 0));
  for (let i = 0; i < 3; i++) {
    const local = zonedParts(utc, timeZone);
    const desiredAsMinutes =
      ((year * 12 + month) * 31 + day) * 1440 + hour * 60 + minute;
    const actualAsMinutes =
      ((local.year * 12 + local.month) * 31 + local.day) * 1440 +
      local.hour * 60 +
      local.minute;
    const deltaMin = desiredAsMinutes - actualAsMinutes;
    if (deltaMin === 0) break;
    utc = new Date(utc.getTime() + deltaMin * 60_000);
  }
  return utc;
}

export function slotKey(startsAt: Date, timeZone = APPOINTMENT_TIMEZONE): string {
  const p = zonedParts(startsAt, timeZone);
  return `${p.year}${pad2(p.month)}${pad2(p.day)}T${pad2(p.hour)}${pad2(p.minute)}`;
}

export function parseSlotKey(
  key: string,
  timeZone = APPOINTMENT_TIMEZONE,
): AppointmentSlot | null {
  const m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})$/.exec(key);
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  const hour = Number(m[4]);
  const minute = Number(m[5]);
  const startsAt = zonedWallTimeToUtc(year, month, day, hour, minute, timeZone);
  const endsAt = new Date(
    startsAt.getTime() + APPOINTMENT_DURATION_MINUTES * 60_000,
  );
  return { startsAt, endsAt, key };
}

export function formatSlotLabel(
  startsAt: Date,
  timeZone = APPOINTMENT_TIMEZONE,
): string {
  return startsAt.toLocaleString("ru-RU", {
    timeZone,
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function overlaps(
  aStart: Date,
  aEnd: Date,
  bStart: Date,
  bEnd: Date,
): boolean {
  return aStart < bEnd && aEnd > bStart;
}

type BusyInterval = { startsAt: Date; endsAt: Date };

function intervalsFromAppointment(a: {
  startsAt: Date;
  endsAt: Date;
  pendingStartsAt: Date | null;
  pendingEndsAt: Date | null;
}): BusyInterval[] {
  const out: BusyInterval[] = [
    { startsAt: a.startsAt, endsAt: a.endsAt },
  ];
  if (a.pendingStartsAt && a.pendingEndsAt) {
    out.push({ startsAt: a.pendingStartsAt, endsAt: a.pendingEndsAt });
  }
  return out;
}

/** Generate candidate slot starts for one local calendar day (Mon–Fri only). */
export function generateDayCandidateSlots(
  year: number,
  month: number,
  day: number,
  timeZone = APPOINTMENT_TIMEZONE,
): AppointmentSlot[] {
  const probe = zonedWallTimeToUtc(year, month, day, 12, 0, timeZone);
  const { weekday } = zonedParts(probe, timeZone);
  if (weekday < 1 || weekday > 5) return [];

  const slots: AppointmentSlot[] = [];
  for (
    let hour = SLOT_DAY_START_HOUR;
    hour < SLOT_DAY_END_HOUR;
    hour += SLOT_STEP_MINUTES / 60
  ) {
    const startsAt = zonedWallTimeToUtc(year, month, day, hour, 0, timeZone);
    const endsAt = new Date(
      startsAt.getTime() + APPOINTMENT_DURATION_MINUTES * 60_000,
    );
    const endParts = zonedParts(endsAt, timeZone);
    // Must finish by 16:00 local on the same day
    if (
      endParts.year !== year ||
      endParts.month !== month ||
      endParts.day !== day ||
      endParts.hour > SLOT_DAY_END_HOUR ||
      (endParts.hour === SLOT_DAY_END_HOUR && endParts.minute > 0)
    ) {
      continue;
    }
    slots.push({ startsAt, endsAt, key: slotKey(startsAt, timeZone) });
  }
  return slots;
}

export function generateCandidateSlots(
  from: Date,
  to: Date,
  timeZone = APPOINTMENT_TIMEZONE,
): AppointmentSlot[] {
  const slots: AppointmentSlot[] = [];
  const startParts = zonedParts(from, timeZone);
  let cursor = zonedWallTimeToUtc(
    startParts.year,
    startParts.month,
    startParts.day,
    0,
    0,
    timeZone,
  );

  while (cursor < to) {
    const p = zonedParts(cursor, timeZone);
    for (const slot of generateDayCandidateSlots(
      p.year,
      p.month,
      p.day,
      timeZone,
    )) {
      if (slot.startsAt >= from && slot.startsAt < to) {
        slots.push(slot);
      }
    }
    cursor = new Date(cursor.getTime() + 24 * 60 * 60 * 1000);
  }
  return slots;
}

export async function listBusyIntervals(input: {
  curatorId: string;
  from: Date;
  to: Date;
  excludeAppointmentId?: string;
}): Promise<BusyInterval[]> {
  const rows = await prisma.appointment.findMany({
    where: {
      assignedCuratorId: input.curatorId,
      status: { in: [...ACTIVE_STATUSES] },
      ...(input.excludeAppointmentId
        ? { id: { not: input.excludeAppointmentId } }
        : {}),
      OR: [
        { startsAt: { lt: input.to }, endsAt: { gt: input.from } },
        {
          pendingStartsAt: { lt: input.to },
          pendingEndsAt: { gt: input.from },
        },
      ],
    },
    select: {
      startsAt: true,
      endsAt: true,
      pendingStartsAt: true,
      pendingEndsAt: true,
    },
  });

  return rows.flatMap(intervalsFromAppointment);
}

export async function listOpenSlots(input: {
  curatorId: string;
  from: Date;
  to: Date;
  excludeAppointmentId?: string;
  timeZone?: string;
}): Promise<AppointmentSlot[]> {
  const timeZone = input.timeZone ?? APPOINTMENT_TIMEZONE;
  const candidates = generateCandidateSlots(input.from, input.to, timeZone);
  const busy = await listBusyIntervals(input);
  const now = new Date();

  return candidates.filter((slot) => {
    if (slot.startsAt < now) return false;
    return !busy.some((b) =>
      overlaps(slot.startsAt, slot.endsAt, b.startsAt, b.endsAt),
    );
  });
}

/** Week range Mon 00:00 – next Mon 00:00 in timezone, containing `anchor`. */
export function weekRangeContaining(
  anchor: Date,
  timeZone = APPOINTMENT_TIMEZONE,
): { from: Date; to: Date } {
  const p = zonedParts(anchor, timeZone);
  let dayStart = zonedWallTimeToUtc(p.year, p.month, p.day, 0, 0, timeZone);
  // Walk back to Monday (weekday === 1)
  for (let i = 0; i < 7; i++) {
    if (zonedParts(dayStart, timeZone).weekday === 1) break;
    dayStart = new Date(dayStart.getTime() - 24 * 60 * 60 * 1000);
  }
  const from = dayStart;
  const to = new Date(from.getTime() + 7 * 24 * 60 * 60 * 1000);
  return { from, to };
}

export function endsAtFromStart(startsAt: Date): Date {
  return new Date(startsAt.getTime() + APPOINTMENT_DURATION_MINUTES * 60_000);
}
