"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { AppointmentAssignPanel } from "./assign-panel";
import { AppointmentDetailPanel } from "./detail-panel";
import { AppointmentsListBoard } from "./list-board";
import { AppointmentsMonthBoard } from "./month-board";
import { AppointmentsHourBoard } from "./week-board";
import type {
  AppointmentSlotDto,
  AppointmentSlotGridDto,
  CalendarAppointmentDto,
  CalendarView,
} from "./types";
import type {
  AppointmentConversationOption,
  AppointmentLeadOption,
  AppointmentStudentOption,
} from "./assign-panel";

const VIEW_LABELS: Record<CalendarView, string> = {
  day: "День",
  week: "Неделя",
  month: "Месяц",
  list: "Список",
};

export function AppointmentsWorkspace({
  view,
  rangeLabel,
  gridDays,
  monthMeta,
  prevHref,
  nextHref,
  todayHref,
  viewHrefs,
  appointments,
  openSlots,
  slotGrid,
  leads,
  students,
  conversations,
  googleCalendarUrl,
  todayYmd,
}: {
  view: CalendarView;
  rangeLabel: string;
  /** Columns for day/week hour board, or full month cells for month view. */
  gridDays: string[];
  monthMeta: { month: number; year: number } | null;
  prevHref: string;
  nextHref: string;
  todayHref: string;
  viewHrefs: Record<CalendarView, string>;
  appointments: CalendarAppointmentDto[];
  openSlots: AppointmentSlotDto[];
  slotGrid: AppointmentSlotGridDto[];
  leads: AppointmentLeadOption[];
  students: AppointmentStudentOption[];
  conversations: AppointmentConversationOption[];
  googleCalendarUrl: string | null;
  todayYmd: string;
}) {
  const router = useRouter();
  const [assignOpen, setAssignOpen] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const selected = useMemo(
    () => appointments.find((a) => a.id === selectedId) ?? null,
    [appointments, selectedId],
  );

  const refresh = () => router.refresh();

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex rounded-full border border-black/10 p-0.5">
            {(Object.keys(VIEW_LABELS) as CalendarView[]).map((v) => (
              <a
                key={v}
                href={viewHrefs[v]}
                className={`rounded-full px-3 py-1 text-[13px] ${
                  view === v
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {VIEW_LABELS[v]}
              </a>
            ))}
          </div>
          {view !== "list" ? (
            <div className="flex items-center gap-1">
              <a
                href={prevHref}
                className="rounded-full border border-black/10 px-3 py-1 text-[13px] hover:bg-muted"
              >
                ←
              </a>
              <a
                href={todayHref}
                className="rounded-full border border-black/10 px-3 py-1 text-[13px] hover:bg-muted"
              >
                Сегодня
              </a>
              <a
                href={nextHref}
                className="rounded-full border border-black/10 px-3 py-1 text-[13px] hover:bg-muted"
              >
                →
              </a>
            </div>
          ) : null}
          <p className="text-sm font-medium">{rangeLabel}</p>
        </div>
        <Button type="button" size="sm" onClick={() => setAssignOpen(true)}>
          Назначить звонок
        </Button>
      </div>

      {view === "list" ? (
        <AppointmentsListBoard
          appointments={appointments}
          selectedId={selectedId}
          onSelect={setSelectedId}
        />
      ) : view === "month" && monthMeta ? (
        <AppointmentsMonthBoard
          monthDays={gridDays}
          month={monthMeta.month}
          year={monthMeta.year}
          appointments={appointments}
          selectedId={selectedId}
          todayYmd={todayYmd}
          onSelectDay={(ymd) => {
            router.push(`/admin/appointments?view=day&date=${ymd}`);
          }}
          onSelectAppointment={setSelectedId}
        />
      ) : (
        <AppointmentsHourBoard
          days={gridDays}
          appointments={appointments}
          selectedId={selectedId}
          todayYmd={todayYmd}
          onSelect={setSelectedId}
        />
      )}

      {selected ? (
        <AppointmentDetailPanel
          appointment={selected}
          openSlots={openSlots}
          onClose={() => setSelectedId(null)}
          onDone={refresh}
        />
      ) : null}

      {assignOpen ? (
        <AppointmentAssignPanel
          leads={leads}
          students={students}
          conversations={conversations}
          slotGrid={slotGrid}
          onClose={() => setAssignOpen(false)}
          onDone={refresh}
        />
      ) : null}

      {googleCalendarUrl ? (
        <div className="pt-2">
          <a
            href={googleCalendarUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex text-[13px] text-[var(--brand)] underline-offset-4 hover:underline"
          >
            Открыть в Google Calendar
          </a>
        </div>
      ) : null}
    </div>
  );
}
