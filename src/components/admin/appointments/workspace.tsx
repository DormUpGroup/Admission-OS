"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { AppointmentAssignPanel } from "./assign-panel";
import { AppointmentDetailPanel } from "./detail-panel";
import { AppointmentsWeekBoard } from "./week-board";
import type {
  AppointmentSlotDto,
  CalendarAppointmentDto,
} from "./types";
import type {
  AppointmentConversationOption,
  AppointmentLeadOption,
  AppointmentStudentOption,
} from "./assign-panel";

export function AppointmentsWorkspace({
  weekLabel,
  weekDays,
  prevWeekHref,
  nextWeekHref,
  appointments,
  openSlots,
  leads,
  students,
  conversations,
}: {
  weekLabel: string;
  weekDays: string[];
  prevWeekHref: string;
  nextWeekHref: string;
  appointments: CalendarAppointmentDto[];
  openSlots: AppointmentSlotDto[];
  leads: AppointmentLeadOption[];
  students: AppointmentStudentOption[];
  conversations: AppointmentConversationOption[];
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
        <div className="flex items-center gap-2">
          <a
            href={prevWeekHref}
            className="rounded-full border border-black/10 px-3 py-1 text-[13px] hover:bg-muted"
          >
            ←
          </a>
          <p className="text-sm font-medium">{weekLabel}</p>
          <a
            href={nextWeekHref}
            className="rounded-full border border-black/10 px-3 py-1 text-[13px] hover:bg-muted"
          >
            →
          </a>
        </div>
        <Button type="button" size="sm" onClick={() => setAssignOpen(true)}>
          Назначить звонок
        </Button>
      </div>

      <AppointmentsWeekBoard
        weekDays={weekDays}
        appointments={appointments}
        selectedId={selectedId}
        onSelect={setSelectedId}
      />

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
          openSlots={openSlots}
          onClose={() => setAssignOpen(false)}
          onDone={refresh}
        />
      ) : null}
    </div>
  );
}
