"use client";

import type { CalendarAppointmentDto } from "./types";
import { romeParts, todayYmdRome } from "./week-board";

function dayNum(ymd: string) {
  return Number(ymd.slice(8, 10));
}

export function AppointmentsMonthBoard({
  monthDays,
  month,
  year,
  appointments,
  selectedId,
  onSelectDay,
  onSelectAppointment,
  todayYmd,
}: {
  /** Full grid Mon–Sun weeks covering the month (YYYY-MM-DD). */
  monthDays: string[];
  month: number;
  year: number;
  appointments: CalendarAppointmentDto[];
  selectedId: string | null;
  onSelectDay: (ymd: string) => void;
  onSelectAppointment: (id: string) => void;
  todayYmd?: string;
}) {
  const today = todayYmd ?? todayYmdRome();
  const byDay = new Map<string, CalendarAppointmentDto[]>();
  for (const a of appointments) {
    const iso = a.pendingStartsAt ?? a.startsAt;
    const ymd = romeParts(iso).ymd;
    const list = byDay.get(ymd) ?? [];
    list.push(a);
    byDay.set(ymd, list);
  }

  const weeks: string[][] = [];
  for (let i = 0; i < monthDays.length; i += 7) {
    weeks.push(monthDays.slice(i, i + 7));
  }

  const weekdayLabels = ["пн", "вт", "ср", "чт", "пт", "сб", "вс"];

  return (
    <div className="overflow-hidden rounded-lg border border-black/5 bg-white">
      <div className="grid grid-cols-7 border-b border-black/5 text-center text-[12px] text-muted-foreground">
        {weekdayLabels.map((w) => (
          <div key={w} className="px-1 py-2 font-medium">
            {w}
          </div>
        ))}
      </div>
      <div className="divide-y divide-black/5">
        {weeks.map((week, wi) => (
          <div key={wi} className="grid grid-cols-7 divide-x divide-black/5">
            {week.map((ymd) => {
              const inMonth = ymd.startsWith(
                `${year}-${String(month).padStart(2, "0")}-`,
              );
              const isToday = ymd === today;
              const items = (byDay.get(ymd) ?? []).slice().sort((a, b) => {
                const aIso = a.pendingStartsAt ?? a.startsAt;
                const bIso = b.pendingStartsAt ?? b.startsAt;
                return aIso.localeCompare(bIso);
              });
              return (
                <button
                  key={ymd}
                  type="button"
                  onClick={() => onSelectDay(ymd)}
                  className={`min-h-24 p-1.5 text-left align-top hover:bg-muted/40 ${
                    isToday
                      ? "bg-primary/10 ring-1 ring-inset ring-primary/30"
                      : inMonth
                        ? "bg-white"
                        : "bg-muted/20 text-muted-foreground"
                  }`}
                >
                  <span
                    className={`text-[12px] font-medium ${
                      isToday
                        ? "inline-flex h-6 w-6 items-center justify-center rounded-full bg-primary text-primary-foreground"
                        : ""
                    }`}
                  >
                    {dayNum(ymd)}
                  </span>
                  <div className="mt-1 space-y-0.5">
                    {items.slice(0, 3).map((a) => {
                      const iso = a.pendingStartsAt ?? a.startsAt;
                      const { hour, minute } = romeParts(iso);
                      const time = `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
                      return (
                      <span
                        key={a.id}
                        role="link"
                        tabIndex={0}
                        onClick={(e) => {
                          e.stopPropagation();
                          onSelectAppointment(a.id);
                        }}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            e.stopPropagation();
                            onSelectAppointment(a.id);
                          }
                        }}
                        className={`block truncate rounded px-1 py-0.5 text-[10px] ${
                          selectedId === a.id
                            ? "bg-primary text-primary-foreground"
                            : a.pendingStartsAt ||
                                a.status === "AWAITING_CLIENT"
                              ? "bg-amber-50 text-amber-950"
                              : "bg-muted"
                        }`}
                      >
                        <span className="font-medium tabular-nums">{time}</span>{" "}
                        {a.subjectLabel}
                      </span>
                      );
                    })}
                    {items.length > 3 ? (
                      <span className="text-[10px] text-muted-foreground">
                        +{items.length - 3}
                      </span>
                    ) : null}
                  </div>
                </button>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
