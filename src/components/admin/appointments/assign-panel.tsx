"use client";

import { useActionState, useEffect, useMemo, useState } from "react";
import { useFormStatus } from "react-dom";
import { createAppointmentAction } from "@/server/appointment-actions";
import { Button } from "@/components/ui/button";
import {
  SLOT_DAY_END_HOUR,
  SLOT_DAY_START_HOUR,
} from "@/lib/appointment-slots";
import type { AppointmentSlotGridDto } from "@/components/admin/appointments/types";
import { dayHeader, HOUR_ROWS, romeParts } from "./week-board";

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

export function AppointmentAssignPanel({
  leads,
  students,
  conversations,
  slotGrid,
  onClose,
  onDone,
}: {
  leads: AppointmentLeadOption[];
  students: AppointmentStudentOption[];
  conversations: AppointmentConversationOption[];
  slotGrid: AppointmentSlotGridDto[];
  onClose: () => void;
  onDone?: () => void;
}) {
  const [leadId, setLeadId] = useState("");
  const [studentId, setStudentId] = useState("");
  const [conversationId, setConversationId] = useState("");
  const [startsAt, setStartsAt] = useState("");
  const [weekOffset, setWeekOffset] = useState(0);
  const [state, formAction] = useActionState(createAppointmentAction, null);
  const canPerson = Boolean(leadId) !== Boolean(studentId);
  const canSubmit = canPerson && Boolean(startsAt);

  const workdayColumns = useMemo(() => {
    return [
      ...new Set(slotGrid.map((s) => romeParts(s.startsAt).ymd)),
    ].sort();
  }, [slotGrid]);

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
    const map = new Map<string, AppointmentSlotGridDto>();
    for (const slot of slotGrid) {
      const p = romeParts(slot.startsAt);
      map.set(`${p.ymd}:${p.hour}`, slot);
    }
    return map;
  }, [slotGrid]);

  useEffect(() => {
    if (state && "ok" in state && state.ok) {
      onDone?.();
      onClose();
    }
  }, [state, onClose, onDone]);

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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <button
        type="button"
        className="absolute inset-0 cursor-default"
        aria-label="Закрыть"
        onClick={onClose}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="assign-call-title"
        className="relative z-10 flex max-h-[90vh] w-full max-w-3xl flex-col overflow-hidden rounded-xl border border-black/10 bg-white shadow-2xl"
      >
        <div className="flex items-center justify-between border-b border-black/5 px-5 py-3">
          <h2 id="assign-call-title" className="text-sm font-semibold">
            Назначить звонок
          </h2>
          <button
            type="button"
            className="text-[13px] text-muted-foreground hover:text-foreground"
            onClick={onClose}
          >
            Закрыть
          </button>
        </div>

        <form
          action={formAction}
          className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-5"
        >
          <input type="hidden" name="leadId" value={leadId} />
          <input type="hidden" name="studentId" value={studentId} />
          <input type="hidden" name="startsAt" value={startsAt} />
          <input type="hidden" name="timezone" value="Europe/Rome" />

          <div className="grid gap-3 sm:grid-cols-2">
            <label className="text-sm">
              <span className="mb-1 block text-muted-foreground">
                Клиент (лид)
              </span>
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
          </div>

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
            <div className="mb-2 flex items-center justify-between gap-2">
              <p className="text-sm text-muted-foreground">
                Слоты {SLOT_DAY_START_HOUR}:00–
                {SLOT_DAY_END_HOUR}:00 Rome · 50 мин
              </p>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  className="rounded-full border border-black/10 px-2 py-0.5 text-[12px] disabled:opacity-40"
                  disabled={safeOffset <= 0}
                  onClick={() => setWeekOffset((o) => Math.max(0, o - 1))}
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
                    setWeekOffset((o) => Math.min(weeks.length - 1, o + 1))
                  }
                >
                  →
                </button>
              </div>
            </div>

            <div className="overflow-x-auto rounded-lg border border-black/10">
              <table className="w-full min-w-[560px] border-collapse text-left text-sm">
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
                  {HOUR_ROWS.map((hour) => (
                    <tr
                      key={hour}
                      className="border-b border-black/5 last:border-0"
                    >
                      <td className="px-2 py-1 font-mono text-[11px] text-muted-foreground">
                        {String(hour).padStart(2, "0")}:00
                      </td>
                      {visibleDays.map((ymd) => {
                        const slot = cellMap.get(`${ymd}:${hour}`);
                        if (!slot) {
                          return (
                            <td
                              key={`${ymd}:${hour}`}
                              className="px-1 py-1"
                            />
                          );
                        }
                        if (slot.status === "open") {
                          const selected = startsAt === slot.startsAt;
                          return (
                            <td key={`${ymd}:${hour}`} className="px-1 py-1">
                              <button
                                type="button"
                                onClick={() => setStartsAt(slot.startsAt)}
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
                        }
                        if (slot.status === "busy") {
                          return (
                            <td key={`${ymd}:${hour}`} className="px-1 py-1">
                              <div className="truncate rounded-md bg-muted px-2 py-1.5 text-[11px] text-muted-foreground">
                                {slot.busyLabel ?? "Занято"}
                              </div>
                            </td>
                          );
                        }
                        return (
                          <td key={`${ymd}:${hour}`} className="px-1 py-1">
                            <div className="rounded-md px-2 py-1.5 text-[11px] text-muted-foreground/50">
                              —
                            </div>
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="mt-1 text-[11px] text-muted-foreground">
              Зелёный — свободно (нажмите). Серый с именем — уже занято.
            </p>
          </div>

          <label className="text-sm">
            <span className="mb-1 block text-muted-foreground">Тема</span>
            <input
              name="title"
              defaultValue="Консультация"
              className={selectClass}
            />
          </label>

          <div className="space-y-2 border-t border-black/5 pt-3">
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
      </div>
    </div>
  );
}
