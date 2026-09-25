"use client";

import { useMemo, useState } from "react";
import { createAppointmentAction } from "@/server/appointment-actions";
import { Button } from "@/components/ui/button";

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
  label: string;
  leadId: string | null;
  studentId: string | null;
};

const selectClass =
  "w-full rounded-md border border-black/10 bg-white px-3 py-2 text-sm disabled:cursor-not-allowed disabled:bg-muted/40 disabled:text-muted-foreground";

export function AppointmentCreateForm({
  leads,
  students,
  conversations,
}: {
  leads: AppointmentLeadOption[];
  students: AppointmentStudentOption[];
  conversations: AppointmentConversationOption[];
}) {
  const [leadId, setLeadId] = useState("");
  const [studentId, setStudentId] = useState("");
  const [conversationId, setConversationId] = useState("");

  const filteredConversations = useMemo(() => {
    if (leadId) {
      return conversations.filter((c) => c.leadId === leadId);
    }
    if (studentId) {
      return conversations.filter((c) => c.studentId === studentId);
    }
    return conversations;
  }, [conversations, leadId, studentId]);

  // Drop conversation if it no longer matches the filtered set.
  const conversationValue = filteredConversations.some(
    (c) => c.id === conversationId,
  )
    ? conversationId
    : "";

  return (
    <form
      action={createAppointmentAction}
      className="grid gap-3 md:grid-cols-2"
    >
      <label className="text-sm">
        <span className="mb-1 block text-muted-foreground">Клиент (лид)</span>
        <select
          name="leadId"
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
          name="studentId"
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

      <label className="text-sm md:col-span-2">
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
        {leadId || studentId ? (
          <p className="mt-1 text-[11px] text-muted-foreground">
            Показаны чаты выбранного клиента
            {filteredConversations.length === 0
              ? " — подходящих OPEN-чатов нет"
              : ""}
            .
          </p>
        ) : null}
      </label>

      <label className="text-sm">
        <span className="mb-1 block text-muted-foreground">Начало</span>
        <input
          type="datetime-local"
          name="startsAt"
          required
          className={selectClass}
        />
      </label>
      <label className="text-sm">
        <span className="mb-1 block text-muted-foreground">Конец</span>
        <input
          type="datetime-local"
          name="endsAt"
          required
          className={selectClass}
        />
      </label>
      <label className="text-sm md:col-span-2">
        <span className="mb-1 block text-muted-foreground">Тема</span>
        <input
          name="title"
          defaultValue="Консультация"
          className={selectClass}
        />
      </label>
      <input type="hidden" name="timezone" value="Europe/Rome" />
      <div className="md:col-span-2">
        <Button type="submit" size="sm">
          Создать (outbox → Calendar)
        </Button>
        <p className="mt-1 text-[11px] text-muted-foreground">
          Укажите ровно одного: клиента (лида) или студента. Нужны worker и
          Google Calendar env.
        </p>
      </div>
    </form>
  );
}
