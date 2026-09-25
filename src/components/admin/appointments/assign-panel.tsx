"use client";

import { useActionState, useEffect, useMemo, useState } from "react";
import { useFormStatus } from "react-dom";
import { createAppointmentAction } from "@/server/appointment-actions";
import { Button } from "@/components/ui/button";
import type { AppointmentSlotDto } from "@/components/admin/appointments/types";

export type AppointmentLeadOption = {
  id: string;
  label: string;
};

export type AppointmentStudentOption = {
  id: string;
  label: string;
};

export type AppointmentConversationOption = {
  id: string;
  leadId: string | null;
  studentId: string | null;
  label: string;
};

function SubmitButton({ canSubmit }: { canSubmit: boolean }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="sm" disabled={!canSubmit || pending}>
      {pending ? "Назначаем…" : "Назначить звонок"}
    </Button>
  );
}

const selectClass =
  "w-full rounded-md border border-black/10 bg-white px-3 py-2 text-sm disabled:cursor-not-allowed disabled:bg-muted/40 disabled:text-muted-foreground";

function dayKey(iso: string) {
  return iso.slice(0, 10);
}

function formatDayLabel(iso: string) {
  const d = new Date(iso);
  return d.toLocaleDateString("ru-RU", {
    weekday: "short",
    day: "numeric",
    month: "short",
    timeZone: "Europe/Rome",
  });
}

function formatTimeLabel(iso: string) {
  return new Date(iso).toLocaleTimeString("ru-RU", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/Rome",
  });
}

export function AppointmentAssignPanel({
  leads,
  students,
  conversations,
  openSlots,
  onClose,
  onDone,
}: {
  leads: AppointmentLeadOption[];
  students: AppointmentStudentOption[];
  conversations: AppointmentConversationOption[];
  openSlots: AppointmentSlotDto[];
  onClose: () => void;
  onDone?: () => void;
}) {
  const [leadId, setLeadId] = useState("");
  const [studentId, setStudentId] = useState("");
  const [conversationId, setConversationId] = useState("");
  const [selectedDay, setSelectedDay] = useState("");
  const [startsAt, setStartsAt] = useState("");
  const [state, formAction] = useActionState(createAppointmentAction, null);
  const canPerson = Boolean(leadId) !== Boolean(studentId);
  const canSubmit = canPerson && Boolean(startsAt);

  const days = useMemo(() => {
    const map = new Map<string, AppointmentSlotDto[]>();
    for (const slot of openSlots) {
      const key = dayKey(slot.startsAt);
      const list = map.get(key) ?? [];
      list.push(slot);
      map.set(key, list);
    }
    return [...map.entries()].map(([key, slots]) => ({
      key,
      label: formatDayLabel(slots[0].startsAt),
      slots,
    }));
  }, [openSlots]);

  useEffect(() => {
    if (!selectedDay && days[0]) setSelectedDay(days[0].key);
  }, [days, selectedDay]);

  useEffect(() => {
    if (state && "ok" in state && state.ok) {
      onDone?.();
      onClose();
    }
  }, [state, onClose, onDone]);

  const daySlots = days.find((d) => d.key === selectedDay)?.slots ?? [];

  const filteredConversations = useMemo(() => {
    if (leadId) return conversations.filter((c) => c.leadId === leadId);
    if (studentId) return conversations.filter((c) => c.studentId === studentId);
    return conversations;
  }, [conversations, leadId, studentId]);

  const conversationValue = filteredConversations.some(
    (c) => c.id === conversationId,
  )
    ? conversationId
    : "";

  return (
    <div className="fixed inset-0 z-40 flex justify-end bg-black/20">
      <button
        type="button"
        className="flex-1 cursor-default"
        aria-label="Закрыть"
        onClick={onClose}
      />
      <aside className="flex h-full w-full max-w-md flex-col border-l border-black/10 bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-black/5 px-4 py-3">
          <h2 className="text-sm font-semibold">Назначить звонок</h2>
          <button
            type="button"
            className="text-[13px] text-muted-foreground hover:text-foreground"
            onClick={onClose}
          >
            Закрыть
          </button>
        </div>

        <form action={formAction} className="flex flex-1 flex-col gap-3 overflow-y-auto p-4">
          <input type="hidden" name="leadId" value={leadId} />
          <input type="hidden" name="studentId" value={studentId} />
          <input type="hidden" name="startsAt" value={startsAt} />
          <input type="hidden" name="timezone" value="Europe/Rome" />

          <label className="text-sm">
            <span className="mb-1 block text-muted-foreground">Клиент (лид)</span>
            <select
              className={selectClass}
              value={leadId}
              disabled={Boolean(studentId)}
              onChange={(e) => {
                const next = e.target.value;
                setLeadId(next);
                if (next) setStudentId("");
                setConversationId("");
              }}
            >
              <option value="">— не выбран —</option>
              {leads.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.label}
                </option>
              ))}
            </select>
          </label>

          <label className="text-sm">
            <span className="mb-1 block text-muted-foreground">Студент</span>
            <select
              className={selectClass}
              value={studentId}
              disabled={Boolean(leadId)}
              onChange={(e) => {
                const next = e.target.value;
                setStudentId(next);
                if (next) setLeadId("");
                setConversationId("");
              }}
            >
              <option value="">— не выбран —</option>
              {students.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label}
                </option>
              ))}
            </select>
          </label>

          <label className="text-sm">
            <span className="mb-1 block text-muted-foreground">
              Чат Telegram (опционально)
            </span>
            <select
              name="conversationId"
              className={selectClass}
              value={conversationValue}
              onChange={(e) => setConversationId(e.target.value)}
            >
              <option value="">— без чата —</option>
              {filteredConversations.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.label}
                </option>
              ))}
            </select>
            {!conversationValue ? (
              <p className="mt-1 text-[11px] text-amber-700">
                Без Telegram подтверждение только вручную в админке.
              </p>
            ) : null}
          </label>

          <div>
            <p className="mb-2 text-sm text-muted-foreground">День</p>
            <div className="flex flex-wrap gap-1.5">
              {days.length === 0 ? (
                <p className="text-sm text-muted-foreground">Нет свободных дней</p>
              ) : (
                days.map((d) => (
                  <button
                    key={d.key}
                    type="button"
                    onClick={() => {
                      setSelectedDay(d.key);
                      setStartsAt("");
                    }}
                    className={`rounded-full px-3 py-1.5 text-[13px] ${
                      selectedDay === d.key
                        ? "bg-primary text-primary-foreground"
                        : "bg-muted text-foreground hover:bg-muted/80"
                    }`}
                  >
                    {d.label}
                  </button>
                ))
              )}
            </div>
          </div>

          <div>
            <p className="mb-2 text-sm text-muted-foreground">Время (50 мин)</p>
            <div className="flex flex-wrap gap-1.5">
              {daySlots.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  Нет свободных слотов в этот день
                </p>
              ) : (
                daySlots.map((slot) => (
                  <button
                    key={slot.key}
                    type="button"
                    onClick={() => setStartsAt(slot.startsAt)}
                    className={`rounded-md border px-3 py-1.5 text-[13px] ${
                      startsAt === slot.startsAt
                        ? "border-primary bg-primary/10 font-medium text-primary"
                        : "border-black/10 hover:border-black/20"
                    }`}
                  >
                    {formatTimeLabel(slot.startsAt)}
                  </button>
                ))
              )}
            </div>
          </div>

          <label className="text-sm">
            <span className="mb-1 block text-muted-foreground">Тема</span>
            <input
              name="title"
              defaultValue="Консультация"
              className={selectClass}
            />
          </label>

          <div className="mt-auto space-y-2 border-t border-black/5 pt-3">
            {state && "error" in state && state.error ? (
              <p className="text-sm text-destructive" role="alert">
                {state.error}
              </p>
            ) : null}
            <SubmitButton canSubmit={canSubmit} />
            <p className="text-[11px] text-muted-foreground">
              Клиенту уйдёт запрос в Telegram. В календарь попадёт после
              подтверждения.
            </p>
          </div>
        </form>
      </aside>
    </div>
  );
}
