"use client";

import {
  SLOT_DAY_END_HOUR,
  SLOT_DAY_START_HOUR,
} from "@/lib/appointment-slots";
import type { CalendarAppointmentDto } from "./types";

const HOURS = Array.from(
  { length: SLOT_DAY_END_HOUR - SLOT_DAY_START_HOUR },
  (_, i) => SLOT_DAY_START_HOUR + i,
);

function romeParts(iso: string) {
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

function dayHeader(ymd: string) {
  const [y, m, d] = ymd.split("-").map(Number);
  const probe = new Date(Date.UTC(y, m - 1, d, 12));
  return probe.toLocaleDateString("ru-RU", {
    weekday: "short",
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });
}

function statusBadge(a: CalendarAppointmentDto) {
  if (a.pendingStartsAt || a.status === "AWAITING_CLIENT") {
    return "Ждёт клиента";
  }
  if (a.status === "CONFIRMED") return "В календаре";
  if (a.status === "PENDING") return "В sync";
  if (a.status === "CANCELLED") return "Отменена";
  return a.status;
}

export function AppointmentsWeekBoard({
  weekDays,
  appointments,
  selectedId,
  onSelect,
}: {
  /** YYYY-MM-DD Mon–Fri */
  weekDays: string[];
  appointments: CalendarAppointmentDto[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  const byCell = new Map<string, CalendarAppointmentDto[]>();
  for (const a of appointments) {
    const displayIso = a.pendingStartsAt ?? a.startsAt;
    const p = romeParts(displayIso);
    if (!weekDays.includes(p.ymd)) continue;
    if (p.hour < SLOT_DAY_START_HOUR || p.hour >= SLOT_DAY_END_HOUR) continue;
    const key = `${p.ymd}:${p.hour}`;
    const list = byCell.get(key) ?? [];
    list.push(a);
    byCell.set(key, list);
  }

  return (
    <div className="overflow-x-auto rounded-lg border border-black/5 bg-white">
      <table className="w-full min-w-[720px] border-collapse text-left text-sm">
        <thead>
          <tr className="border-b border-black/5 text-[12px] text-muted-foreground">
            <th className="w-16 px-2 py-2 font-medium">UTC+1/2</th>
            {weekDays.map((ymd) => (
              <th key={ymd} className="px-2 py-2 font-medium">
                {dayHeader(ymd)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {HOURS.map((hour) => (
            <tr key={hour} className="border-b border-black/5 last:border-0">
              <td className="px-2 py-2 align-top font-mono text-[11px] text-muted-foreground">
                {String(hour).padStart(2, "0")}:00
              </td>
              {weekDays.map((ymd) => {
                const cell = byCell.get(`${ymd}:${hour}`) ?? [];
                return (
                  <td key={`${ymd}:${hour}`} className="h-14 px-1 py-1 align-top">
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
