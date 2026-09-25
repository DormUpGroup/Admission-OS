"use client";

import { useMemo, useState } from "react";
import type { CalendarAppointmentDto } from "./types";
import { appointmentChipClass, statusBadge } from "./week-board";

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
  const [query, setQuery] = useState("");

  const sorted = useMemo(() => {
    const rows = [...appointments].sort((a, b) => {
      const aIso = a.pendingStartsAt ?? a.startsAt;
      const bIso = b.pendingStartsAt ?? b.startsAt;
      return aIso.localeCompare(bIso);
    });
    const q = query.trim().toLowerCase().replace(/^@/, "");
    if (!q) return rows;
    return rows.filter((a) => {
      const hay = [a.subjectLabel, a.nickname, a.alias]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .replace(/@/g, "");
      return hay.includes(q);
    });
  }, [appointments, query]);

  return (
    <div className="space-y-3">
      <input
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Имя или ник"
        className="w-full max-w-sm rounded-full border-0 bg-white px-3.5 py-2 text-sm outline-none ring-1 ring-black/10 placeholder:text-muted-foreground focus:ring-black/20"
      />
      {sorted.length === 0 ? (
        <div className="rounded-lg border border-black/5 bg-white px-4 py-10 text-center text-sm text-muted-foreground">
          {query.trim() ? "Ничего не найдено" : "Нет консультаций"}
        </div>
      ) : (
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
                  active ? "bg-primary/10" : appointmentChipClass(a, false)
                }`}
                onClick={() => onSelect(a.id)}
              >
                <td className="whitespace-nowrap px-3 py-2.5 tabular-nums">
                  {formatWhen(whenIso)}
                </td>
                <td className="px-3 py-2.5 font-medium">
                  {a.subjectLabel}
                  {a.nickname ? (
                    <span className="ml-1.5 font-normal text-muted-foreground">
                      @{a.nickname}
                    </span>
                  ) : null}
                </td>
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
      )}
    </div>
  );
}
