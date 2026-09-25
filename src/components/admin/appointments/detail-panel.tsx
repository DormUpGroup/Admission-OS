"use client";

import { useActionState, useEffect, useMemo, useState } from "react";
import { useFormStatus } from "react-dom";
import {
  cancelAppointmentAction,
  confirmAppointmentManualAction,
  proposeRescheduleAppointmentAction,
} from "@/server/appointment-actions";
import { Button } from "@/components/ui/button";
import type {
  AppointmentSlotDto,
  CalendarAppointmentDto,
} from "./types";

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

function dayKey(iso: string) {
  return new Date(iso).toLocaleDateString("en-CA", {
    timeZone: "Europe/Rome",
  });
}

function RescheduleSubmit({
  canSubmit,
  confirmLabel,
}: {
  canSubmit: boolean;
  confirmLabel: string;
}) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="sm" disabled={!canSubmit || pending}>
      {pending ? "Отправляем…" : confirmLabel}
    </Button>
  );
}

export function AppointmentDetailPanel({
  appointment,
  openSlots,
  onClose,
  onDone,
}: {
  appointment: CalendarAppointmentDto;
  openSlots: AppointmentSlotDto[];
  onClose: () => void;
  onDone?: () => void;
}) {
  const [mode, setMode] = useState<"view" | "reschedule">("view");
  const [selectedDay, setSelectedDay] = useState("");
  const [startsAt, setStartsAt] = useState("");
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [state, formAction] = useActionState(
    proposeRescheduleAppointmentAction,
    null,
  );

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
      label: formatWhen(slots[0].startsAt).replace(/,? \d{2}:\d{2}$/, ""),
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
  const currentIso = appointment.pendingStartsAt ?? appointment.startsAt;
  const awaiting =
    Boolean(appointment.pendingStartsAt) ||
    appointment.status === "AWAITING_CLIENT";

  return (
    <div className="rounded-lg border border-black/5 bg-white p-4">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold">{appointment.title}</h3>
          <p className="text-sm text-muted-foreground">
            {appointment.subjectLabel}
          </p>
        </div>
        <button
          type="button"
          className="text-[13px] text-muted-foreground hover:text-foreground"
          onClick={onClose}
        >
          Скрыть
        </button>
      </div>

      <dl className="mb-4 grid gap-1 text-sm">
        <div className="flex justify-between gap-4">
          <dt className="text-muted-foreground">Сейчас</dt>
          <dd>{formatWhen(appointment.startsAt)}</dd>
        </div>
        {appointment.pendingStartsAt ? (
          <div className="flex justify-between gap-4">
            <dt className="text-muted-foreground">Предложено</dt>
            <dd className="text-amber-800">
              {formatWhen(appointment.pendingStartsAt)}
            </dd>
          </div>
        ) : null}
        <div className="flex justify-between gap-4">
          <dt className="text-muted-foreground">Статус</dt>
          <dd>{awaiting ? "Ждёт подтверждения клиента" : appointment.status}</dd>
        </div>
      </dl>

      {mode === "view" ? (
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => setMode("reschedule")}
          >
            Перенести
          </Button>
          {awaiting && !appointment.hasTelegram ? (
            <form action={confirmAppointmentManualAction}>
              <input type="hidden" name="appointmentId" value={appointment.id} />
              <Button type="submit" size="sm" variant="outline">
                Подтвердить вручную
              </Button>
            </form>
          ) : null}
          <form action={cancelAppointmentAction}>
            <input type="hidden" name="appointmentId" value={appointment.id} />
            <Button type="submit" size="sm" variant="destructive">
              Отменить
            </Button>
          </form>
        </div>
      ) : (
        <form action={formAction} className="space-y-3">
          <input type="hidden" name="appointmentId" value={appointment.id} />
          <input type="hidden" name="startsAt" value={startsAt} />

          <p className="text-sm text-muted-foreground">Новый день</p>
          <div className="flex flex-wrap gap-1.5">
            {days.map((d) => (
              <button
                key={d.key}
                type="button"
                onClick={() => {
                  setSelectedDay(d.key);
                  setStartsAt("");
                  setConfirmOpen(false);
                }}
                className={`rounded-full px-3 py-1.5 text-[13px] ${
                  selectedDay === d.key
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted"
                }`}
              >
                {d.label}
              </button>
            ))}
          </div>

          <p className="text-sm text-muted-foreground">Новое время</p>
          <div className="flex flex-wrap gap-1.5">
            {daySlots.map((slot) => (
              <button
                key={slot.key}
                type="button"
                onClick={() => {
                  setStartsAt(slot.startsAt);
                  setConfirmOpen(false);
                }}
                className={`rounded-md border px-3 py-1.5 text-[13px] ${
                  startsAt === slot.startsAt
                    ? "border-primary bg-primary/10"
                    : "border-black/10"
                }`}
              >
                {new Date(slot.startsAt).toLocaleTimeString("ru-RU", {
                  hour: "2-digit",
                  minute: "2-digit",
                  timeZone: "Europe/Rome",
                })}
              </button>
            ))}
          </div>

          {confirmOpen && startsAt ? (
            <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950">
              <p className="font-medium">Подтвердите перенос</p>
              <p className="mt-1">
                {appointment.subjectLabel}: {formatWhen(currentIso)} →{" "}
                {formatWhen(startsAt)}
              </p>
              <p className="mt-1 text-[12px]">
                Клиенту уйдёт предупреждение в Telegram. Время в Google Calendar
                сменится только после его подтверждения.
              </p>
              <div className="mt-3 flex gap-2">
                <RescheduleSubmit
                  canSubmit={Boolean(startsAt)}
                  confirmLabel="Отправить клиенту"
                />
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={() => setConfirmOpen(false)}
                >
                  Назад
                </Button>
              </div>
            </div>
          ) : (
            <div className="flex gap-2">
              <Button
                type="button"
                size="sm"
                disabled={!startsAt}
                onClick={() => setConfirmOpen(true)}
              >
                Далее
              </Button>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => setMode("view")}
              >
                Отмена
              </Button>
            </div>
          )}

          {state && "error" in state && state.error ? (
            <p className="text-sm text-destructive">{state.error}</p>
          ) : null}
        </form>
      )}
    </div>
  );
}
