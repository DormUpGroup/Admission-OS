import { registerOutboxHandler } from "../dispatch";
import { handleAppointmentClientNudge } from "./appointment-nudge";
import { handleCalendarDelete, handleCalendarUpsert } from "./calendar";
import { handleHermesCreateRun, handleHermesPollRun } from "./hermes";
import {
  handleClientActivated,
  handleProgramsMatchRequested,
  handleSchedulingRequested,
} from "./profiles";
import { handleNoop, handleWorkerLog } from "./noop";
import { handleProgramsMatch } from "./programs-match";
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
  registerOutboxHandler("hermes.poll_run", handleHermesPollRun);
  registerOutboxHandler("scheduling.requested", handleSchedulingRequested);
  registerOutboxHandler("client.activated", handleClientActivated);
  registerOutboxHandler("programs.match", handleProgramsMatch);
  registerOutboxHandler("programs.match.requested", handleProgramsMatchRequested);
}
