import { registerOutboxHandler } from "../dispatch";
import { handleAppointmentClientNudge } from "./appointment-nudge";
import { handleCalendarDelete, handleCalendarUpsert } from "./calendar";
import { handleHermesCreateRun } from "./hermes";
import { handleNoop, handleWorkerLog } from "./noop";
import { handleMessageReceived, handleTelegramSend } from "./telegram";

export function registerBuiltinHandlers(): void {
  registerOutboxHandler("noop", handleNoop);
  registerOutboxHandler("worker.log", handleWorkerLog);
  registerOutboxHandler("message.received", handleMessageReceived);
  registerOutboxHandler("telegram.send", handleTelegramSend);
  registerOutboxHandler("calendar.upsert", handleCalendarUpsert);
  registerOutboxHandler("calendar.delete", handleCalendarDelete);
  registerOutboxHandler("appointment.client_nudge", handleAppointmentClientNudge);
  registerOutboxHandler("hermes.create_run", handleHermesCreateRun);
}
