"use client";

import { useMemo, useState } from "react";
import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { bookConsultationAction, bookGuestConsultationAction } from "@/server/booking-actions";
import { Button } from "@/components/ui/button";
import {
  SLOT_DAY_END_HOUR,
  SLOT_DAY_START_HOUR,
} from "@/lib/appointment-slots";

export type OpenSlotDto = { startsAt: string };

const HOUR_ROWS = Array.from(
  { length: SLOT_DAY_END_HOUR - SLOT_DAY_START_HOUR },
  (_, i) => SLOT_DAY_START_HOUR + i,
);

function romeParts(iso: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Europe/Rome",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(iso));
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  return {
    ymd: `${get("year")}-${get("month")}-${get("day")}`,
    hour: Number(get("hour")),
  };
}

function dayHeader(ymd: string) {
  const [year, month, day] = ymd.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day, 12)).toLocaleDateString("ru-RU", {
    weekday: "short",
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });
}

function SubmitButton({ canSubmit }: { canSubmit: boolean }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" className="w-full" size="lg" disabled={!canSubmit || pending}>
      {pending ? "Записываем…" : "Подтвердить"}
    </Button>
  );
}

export function BookingCalendar({
  slots,
  action = bookConsultationAction,
  children,
}: {
  slots: OpenSlotDto[];
  action?: typeof bookGuestConsultationAction;
  children?: React.ReactNode;
}) {
  const [startsAt, setStartsAt] = useState("");
  const [weekOffset, setWeekOffset] = useState(0);
  const [state, formAction] = useActionState(action, null);

  const workdayColumns = useMemo(() => {
    return [...new Set(slots.map((slot) => romeParts(slot.startsAt).ymd))].sort();
  }, [slots]);

  const weeks = useMemo(() => {
    const chunks: string[][] = [];
    for (let i = 0; i < workdayColumns.length; i += 5) {
      chunks.push(workdayColumns.slice(i, i + 5));
    }
    return chunks.length > 0 ? chunks : [[]];
  }, [workdayColumns]);

  const safeOffset = Math.min(weekOffset, Math.max(0, weeks.length - 1));
  const visibleDays = weeks[safeOffset] ?? [];

  const cellMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const slot of slots) {
      const parts = romeParts(slot.startsAt);
      map.set(`${parts.ymd}:${parts.hour}`, slot.startsAt);
    }
    return map;
  }, [slots]);

  const visibleHours = HOUR_ROWS.filter((hour) =>
    visibleDays.some((ymd) => cellMap.has(`${ymd}:${hour}`)),
  );

  if (slots.length === 0) {
    return (
      <p className="text-[15px] text-muted-foreground">
        Свободных слотов на ближайшие три недели нет. Напишите куратору в Telegram.
      </p>
    );
  }

  return (
    <form action={formAction} className="space-y-4">
      {children}
      <input type="hidden" name="startsAt" value={startsAt} />
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">
          Свободное время, {SLOT_DAY_START_HOUR}:00–{SLOT_DAY_END_HOUR}:00, Рим
        </p>
        <div className="flex items-center gap-1">
          <button
            type="button"
            className="rounded-full border border-black/10 px-2 py-0.5 text-[12px] disabled:opacity-40"
            disabled={safeOffset <= 0}
            onClick={() => setWeekOffset((offset) => Math.max(0, offset - 1))}
          >
            ←
          </button>
          <span className="text-[12px] text-muted-foreground">
            {safeOffset + 1}/{weeks.length}
          </span>
          <button
            type="button"
            className="rounded-full border border-black/10 px-2 py-0.5 text-[12px] disabled:opacity-40"
            disabled={safeOffset >= weeks.length - 1}
            onClick={() =>
              setWeekOffset((offset) => Math.min(weeks.length - 1, offset + 1))
            }
          >
            →
          </button>
        </div>
      </div>

      <div className="overflow-x-auto rounded-lg border border-black/10">
        <table className="w-full min-w-[520px] border-collapse text-left text-sm">
          <thead>
            <tr className="border-b border-black/5 bg-muted/30 text-[12px] text-muted-foreground">
              <th className="w-14 px-2 py-2 font-medium">Время</th>
              {visibleDays.map((ymd) => (
                <th key={ymd} className="px-1 py-2 font-medium">
                  {dayHeader(ymd)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {visibleHours.map((hour) => (
              <tr key={hour} className="border-b border-black/5 last:border-0">
                <td className="px-2 py-1 font-mono text-[11px] text-muted-foreground">
                  {String(hour).padStart(2, "0")}:00
                </td>
                {visibleDays.map((ymd) => {
                  const slot = cellMap.get(`${ymd}:${hour}`);
                  if (!slot) return <td key={`${ymd}:${hour}`} className="px-1 py-1" />;
                  const selected = startsAt === slot;
                  return (
                    <td key={`${ymd}:${hour}`} className="px-1 py-1">
                      <button
                        type="button"
                        onClick={() => setStartsAt(slot)}
                        className={`w-full rounded-md px-2 py-1.5 text-[12px] ${
                          selected
                            ? "bg-primary text-primary-foreground"
                            : "bg-emerald-50 text-emerald-900 ring-1 ring-emerald-200 hover:bg-emerald-100"
                        }`}
                      >
                        Свободно
                      </button>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {state?.error ? (
        <p className="text-sm text-[var(--danger-fg)]" role="alert">
          {state.error}
        </p>
      ) : null}
      <SubmitButton canSubmit={Boolean(startsAt)} />
    </form>
  );
}
