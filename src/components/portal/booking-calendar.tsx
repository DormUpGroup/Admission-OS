"use client";

import { useMemo, useState } from "react";
import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { bookGuestConsultationAction } from "@/server/booking-actions";
import { Button } from "@/components/ui/button";
import { SLOT_DAY_END_HOUR, SLOT_DAY_START_HOUR } from "@/lib/appointment-slots";

export type OpenSlotDto = { startsAt: string };

const WEEKDAY_LABELS = ["пн", "вт", "ср", "чт", "пт", "сб", "вс"];

function romeParts(iso: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Europe/Rome",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(iso));
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  return {
    ymd: `${get("year")}-${get("month")}-${get("day")}`,
    hour: Number(get("hour")),
    minute: Number(get("minute")),
  };
}

function todayYmdRome() {
  return romeParts(new Date().toISOString()).ymd;
}

function parseYmd(ymd: string) {
  const [year, month, day] = ymd.split("-").map(Number);
  return { year, month, day };
}

/** Monday-first month grid as YYYY-MM-DD (UTC noon anchors). */
function monthGrid(year: number, month: number): string[] {
  const first = new Date(Date.UTC(year, month - 1, 1, 12));
  const dow = first.getUTCDay();
  const mondayOffset = dow === 0 ? -6 : 1 - dow;
  const start = new Date(first);
  start.setUTCDate(first.getUTCDate() + mondayOffset);

  const last = new Date(Date.UTC(year, month, 0, 12));
  const lastDow = last.getUTCDay();
  const sundayOffset = lastDow === 0 ? 0 : 7 - lastDow;
  const end = new Date(last);
  end.setUTCDate(last.getUTCDate() + sundayOffset);

  const days: string[] = [];
  for (let cursor = new Date(start); cursor <= end; cursor.setUTCDate(cursor.getUTCDate() + 1)) {
    days.push(cursor.toISOString().slice(0, 10));
  }
  return days;
}

function monthTitle(year: number, month: number) {
  return new Date(Date.UTC(year, month - 1, 1, 12)).toLocaleDateString("ru-RU", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

function dayLongLabel(ymd: string) {
  const { year, month, day } = parseYmd(ymd);
  return new Date(Date.UTC(year, month - 1, day, 12)).toLocaleDateString("ru-RU", {
    weekday: "long",
    day: "numeric",
    month: "long",
    timeZone: "UTC",
  });
}

function shiftMonth(year: number, month: number, delta: number) {
  const date = new Date(Date.UTC(year, month - 1 + delta, 1, 12));
  return { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1 };
}

function formatHour(hour: number, minute = 0) {
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

function SubmitButton({ canSubmit }: { canSubmit: boolean }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" className="w-full" size="lg" disabled={!canSubmit || pending}>
      {pending ? "Записываем…" : "Подтвердить запись"}
    </Button>
  );
}

export function BookingCalendar({
  slots,
  action,
  children,
}: {
  slots: OpenSlotDto[];
  action: typeof bookGuestConsultationAction;
  children?: React.ReactNode;
}) {
  const [startsAt, setStartsAt] = useState("");
  const [selectedYmd, setSelectedYmd] = useState("");
  const [state, formAction] = useActionState(action, null);

  const freeByDay = useMemo(() => {
    const map = new Map<string, { startsAt: string; hour: number; minute: number }[]>();
    for (const slot of slots) {
      const parts = romeParts(slot.startsAt);
      const list = map.get(parts.ymd) ?? [];
      list.push({ startsAt: slot.startsAt, hour: parts.hour, minute: parts.minute });
      map.set(parts.ymd, list);
    }
    for (const list of map.values()) {
      list.sort((a, b) => a.startsAt.localeCompare(b.startsAt));
    }
    return map;
  }, [slots]);

  const freeDays = useMemo(() => [...freeByDay.keys()].sort(), [freeByDay]);

  const bounds = useMemo(() => {
    if (freeDays.length === 0) return null;
    return {
      first: parseYmd(freeDays[0]),
      last: parseYmd(freeDays[freeDays.length - 1]),
    };
  }, [freeDays]);

  const initialView = useMemo(() => {
    if (!bounds) {
      const today = parseYmd(todayYmdRome());
      return { year: today.year, month: today.month };
    }
    return { year: bounds.first.year, month: bounds.first.month };
  }, [bounds]);

  const [view, setView] = useState(initialView);
  const grid = useMemo(() => monthGrid(view.year, view.month), [view.year, view.month]);
  const today = todayYmdRome();
  const monthPrefix = `${view.year}-${String(view.month).padStart(2, "0")}-`;

  const canGoPrev =
    bounds != null &&
    (view.year > bounds.first.year ||
      (view.year === bounds.first.year && view.month > bounds.first.month));
  const canGoNext =
    bounds != null &&
    (view.year < bounds.last.year ||
      (view.year === bounds.last.year && view.month < bounds.last.month));

  const daySlots = selectedYmd ? (freeByDay.get(selectedYmd) ?? []) : [];

  function pickDay(ymd: string) {
    if (!freeByDay.has(ymd)) return;
    setSelectedYmd(ymd);
    setStartsAt("");
  }

  if (slots.length === 0) {
    return (
      <p className="text-[15px] text-muted-foreground">
        Свободных слотов на ближайшее время нет. Напишите в Telegram, и мы пришлём новую ссылку.
      </p>
    );
  }

  return (
    <form action={formAction} className="space-y-5">
      {children}
      <input type="hidden" name="startsAt" value={startsAt} />

      <div className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-[15px] font-semibold tracking-tight text-foreground capitalize">
              {monthTitle(view.year, view.month)}
            </p>
            <p className="mt-0.5 text-[13px] text-muted-foreground">
              Выберите свободный день, {SLOT_DAY_START_HOUR}:00–{SLOT_DAY_END_HOUR}:00 · Рим
            </p>
          </div>
          <div className="flex items-center gap-1">
            <button
              type="button"
              aria-label="Предыдущий месяц"
              className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-black/10 text-[15px] disabled:opacity-35"
              disabled={!canGoPrev}
              onClick={() => setView((current) => shiftMonth(current.year, current.month, -1))}
            >
              ←
            </button>
            <button
              type="button"
              aria-label="Следующий месяц"
              className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-black/10 text-[15px] disabled:opacity-35"
              disabled={!canGoNext}
              onClick={() => setView((current) => shiftMonth(current.year, current.month, 1))}
            >
              →
            </button>
          </div>
        </div>

        <div className="overflow-hidden rounded-2xl border border-black/10 bg-white">
          <div className="grid grid-cols-7 border-b border-black/5 bg-muted/30 text-center text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground">
            {WEEKDAY_LABELS.map((label) => (
              <div key={label} className="px-1 py-2.5">
                {label}
              </div>
            ))}
          </div>
          <div className="divide-y divide-black/5">
            {Array.from({ length: grid.length / 7 }, (_, weekIndex) => (
              <div key={weekIndex} className="grid grid-cols-7 divide-x divide-black/5">
                {grid.slice(weekIndex * 7, weekIndex * 7 + 7).map((ymd) => {
                  const inMonth = ymd.startsWith(monthPrefix);
                  const hasSlots = freeByDay.has(ymd);
                  const isToday = ymd === today;
                  const selected = selectedYmd === ymd;
                  const dayNumber = Number(ymd.slice(8, 10));
                  return (
                    <button
                      key={ymd}
                      type="button"
                      disabled={!hasSlots}
                      onClick={() => pickDay(ymd)}
                      className={[
                        "relative flex min-h-[3.25rem] flex-col items-center justify-center gap-1 px-1 py-2 transition sm:min-h-[4.5rem]",
                        inMonth ? "bg-white" : "bg-muted/25 text-muted-foreground",
                        hasSlots ? "hover:bg-primary/5" : "cursor-default opacity-45",
                        selected ? "bg-primary/10 ring-1 ring-inset ring-primary/35" : "",
                        isToday && !selected ? "bg-muted/60" : "",
                      ].join(" ")}
                    >
                      <span
                        className={[
                          "inline-flex h-7 w-7 items-center justify-center rounded-full text-[13px] font-medium tabular-nums",
                          selected
                            ? "bg-primary text-primary-foreground"
                            : isToday
                              ? "bg-foreground text-background"
                              : "",
                        ].join(" ")}
                      >
                        {dayNumber}
                      </span>
                      {hasSlots ? (
                        <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" aria-hidden />
                      ) : (
                        <span className="h-1.5 w-1.5" aria-hidden />
                      )}
                    </button>
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      </div>

      {selectedYmd ? (
        <div className="space-y-3 rounded-2xl border border-black/10 bg-white p-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-[13px] text-muted-foreground">Свободное время</p>
              <p className="text-[16px] font-semibold tracking-tight capitalize text-foreground">
                {dayLongLabel(selectedYmd)}
              </p>
            </div>
            <button
              type="button"
              className="text-[13px] text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
              onClick={() => {
                setSelectedYmd("");
                setStartsAt("");
              }}
            >
              Другой день
            </button>
          </div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {daySlots.map((slot) => {
              const selected = startsAt === slot.startsAt;
              return (
                <button
                  key={slot.startsAt}
                  type="button"
                  onClick={() => setStartsAt(slot.startsAt)}
                  className={[
                    "rounded-xl px-3 py-3 text-[15px] font-medium tabular-nums transition",
                    selected
                      ? "bg-primary text-primary-foreground shadow-sm"
                      : "bg-emerald-50 text-emerald-950 ring-1 ring-emerald-200/80 hover:bg-emerald-100",
                  ].join(" ")}
                >
                  {formatHour(slot.hour, slot.minute)}
                </button>
              );
            })}
          </div>
        </div>
      ) : (
        <p className="text-[14px] text-muted-foreground">
          Зелёная точка — день со свободными часами.
        </p>
      )}

      {state?.error ? (
        <p className="text-sm text-[var(--danger-fg)]" role="alert">
          {state.error}
        </p>
      ) : null}
      <SubmitButton canSubmit={Boolean(startsAt)} />
    </form>
  );
}
