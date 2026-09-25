"use client";

import {
  SLOT_DAY_END_HOUR,
  SLOT_DAY_START_HOUR,
} from "@/lib/appointment-slots";
import type { CalendarAppointmentDto } from "./types";

export const HOUR_ROWS = Array.from(
  { length: SLOT_DAY_END_HOUR - SLOT_DAY_START_HOUR },
  (_, i) => SLOT_DAY_START_HOUR + i,
);

export function romeParts(iso: string) {
  const d = new Date(iso);
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Europe/Rome",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    weekday: "short",
    hourCycle: "h23",
  }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return {
    ymd: `${get("year")}-${get("month")}-${get("day")}`,
    hour: Number(get("hour")),
    minute: Number(get("minute")),
    weekday: get("weekday"),
  };
}

export function dayHeader(ymd: string) {
  const [y, m, d] = ymd.split("-").map(Number);
  const probe = new Date(Date.UTC(y, m - 1, d, 12));
  return probe.toLocaleDateString("ru-RU", {
    weekday: "short",
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });
}

/** Today's calendar date in Europe/Rome as YYYY-MM-DD. */
export function todayYmdRome(now = new Date()): string {
  return romeParts(now.toISOString()).ymd;
}

export function statusBadge(a: CalendarAppointmentDto) {
  if (a.pendingStartsAt || a.status === "AWAITING_CLIENT") {
    return "Ждёт клиента";
  }
  if (a.status === "CONFIRMED") return "В календаре";
  if (a.status === "PENDING") return "В sync";
  if (a.status === "CANCELLED") return "Отменена";
  return a.status;
}

/** Day or week hour grid (one or many YYYY-MM-DD columns). */
export function AppointmentsHourBoard({
  days,
  appointments,
  selectedId,
  onSelect,
  todayYmd,
}: {
  days: string[];
  appointments: CalendarAppointmentDto[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  todayYmd?: string;
}) {
  const today = todayYmd ?? todayYmdRome();
  const byCell = new Map<string, CalendarAppointmentDto[]>();
  for (const a of appointments) {
    const displayIso = a.pendingStartsAt ?? a.startsAt;
    const p = romeParts(displayIso);
    if (!days.includes(p.ymd)) continue;
    if (p.hour < SLOT_DAY_START_HOUR || p.hour >= SLOT_DAY_END_HOUR) continue;
    const key = `${p.ymd}:${p.hour}`;
    const list = byCell.get(key) ?? [];
    list.push(a);
    byCell.set(key, list);
  }

  const minWidth = days.length <= 1 ? "360px" : "720px";

  return (
    <div className="overflow-x-auto rounded-lg border border-black/5 bg-white">
      <table
        className="w-full border-collapse text-left text-sm"
        style={{ minWidth }}
      >
        <thead>
          <tr className="border-b border-black/5 text-[12px] text-muted-foreground">
            <th className="w-16 px-2 py-2 font-medium">Rome</th>
            {days.map((ymd) => {
              const isToday = ymd === today;
              return (
                <th
                  key={ymd}
                  className={`px-2 py-2 font-medium ${
                    isToday
                      ? "bg-primary/10 text-foreground"
                      : ""
                  }`}
                >
                  <span className="inline-flex flex-col gap-0.5">
                    <span>{dayHeader(ymd)}</span>
                    {isToday ? (
                      <span className="text-[10px] font-semibold uppercase tracking-wide text-primary">
                        сегодня
                      </span>
                    ) : null}
                  </span>
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {HOUR_ROWS.map((hour) => (
            <tr key={hour} className="border-b border-black/5 last:border-0">
              <td className="px-2 py-2 align-top font-mono text-[11px] text-muted-foreground">
                {String(hour).padStart(2, "0")}:00
              </td>
              {days.map((ymd) => {
                const cell = byCell.get(`${ymd}:${hour}`) ?? [];
                const isToday = ymd === today;
                return (
                  <td
                    key={`${ymd}:${hour}`}
                    className={`h-14 px-1 py-1 align-top ${
                      isToday ? "bg-primary/5" : ""
                    }`}
                  >
                    <div className="flex flex-col gap-1">
                      {cell.map((a) => {
                        const awaiting =
                          Boolean(a.pendingStartsAt) ||
                          a.status === "AWAITING_CLIENT";
                        return (
                          <button
                            key={a.id}
                            type="button"
                            onClick={() => onSelect(a.id)}
                            className={`w-full rounded-md px-2 py-1 text-left text-[11px] leading-snug ${
                              selectedId === a.id
                                ? "bg-primary text-primary-foreground"
                                : awaiting
                                  ? "bg-amber-50 text-amber-950 ring-1 ring-amber-200"
                                  : "bg-muted hover:bg-muted/80"
                            }`}
                          >
                            <span className="block truncate font-medium">
                              {a.subjectLabel}
                            </span>
                            <span className="block truncate opacity-80">
                              {statusBadge(a)}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** @deprecated prefer AppointmentsHourBoard */
export function AppointmentsWeekBoard(
  props: {
    weekDays: string[];
    appointments: CalendarAppointmentDto[];
    selectedId: string | null;
    onSelect: (id: string) => void;
  },
) {
  return (
    <AppointmentsHourBoard
      days={props.weekDays}
      appointments={props.appointments}
      selectedId={props.selectedId}
      onSelect={props.onSelect}
    />
  );
}
