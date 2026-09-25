"use client";

import type { CalendarAppointmentDto } from "./types";
import { statusBadge } from "./week-board";

function formatWhen(iso: string) {
  return new Date(iso).toLocaleString("ru-RU", {
    timeZone: "Europe/Rome",
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function AppointmentsListBoard({
  appointments,
  selectedId,
  onSelect,
}: {
  appointments: CalendarAppointmentDto[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  const sorted = [...appointments].sort((a, b) => {
    const aIso = a.pendingStartsAt ?? a.startsAt;
    const bIso = b.pendingStartsAt ?? b.startsAt;
    return aIso.localeCompare(bIso);
  });

  if (sorted.length === 0) {
    return (
      <div className="rounded-lg border border-black/5 bg-white px-4 py-10 text-center text-sm text-muted-foreground">
        Нет консультаций
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-lg border border-black/5 bg-white">
      <table className="w-full text-left text-sm">
        <thead className="border-b border-black/5 text-[12px] text-muted-foreground">
          <tr>
            <th className="px-3 py-2.5 font-medium">Когда (Rome)</th>
            <th className="px-3 py-2.5 font-medium">Клиент</th>
            <th className="px-3 py-2.5 font-medium">Статус</th>
            <th className="px-3 py-2.5 font-medium">Канал</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((a) => {
            const whenIso = a.pendingStartsAt ?? a.startsAt;
            const active = selectedId === a.id;
            return (
              <tr
                key={a.id}
                className={`cursor-pointer border-b border-black/5 last:border-0 ${
                  active
                    ? "bg-primary/10"
                    : "hover:bg-muted/40"
                }`}
                onClick={() => onSelect(a.id)}
              >
                <td className="whitespace-nowrap px-3 py-2.5 tabular-nums">
                  {formatWhen(whenIso)}
                </td>
                <td className="px-3 py-2.5 font-medium">{a.subjectLabel}</td>
                <td className="px-3 py-2.5 text-muted-foreground">
                  {statusBadge(a)}
                </td>
                <td className="px-3 py-2.5 text-muted-foreground">
                  {a.hasTelegram ? "Telegram" : "—"}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
