import type { OutboxHandler } from "../dispatch";
import {
  callCalendarDelete,
  callCalendarUpsert,
  finalizeCalendarDelete,
  finalizeCalendarUpsert,
  prepareCalendarDelete,
  prepareCalendarUpsert,
} from "@/server/delivery/google-calendar";

export const handleCalendarUpsert: OutboxHandler = async (_db, event) => {
  const prepared = await prepareCalendarUpsert(event);
  if (prepared.action === "skip") {
    return;
  }
  const result = await callCalendarUpsert(prepared);
  await finalizeCalendarUpsert(prepared.appointment.id, result.googleEventId);
  console.log(
    JSON.stringify({
      level: "info",
      msg: "calendar.upsert.done",
      eventId: event.id,
      appointmentId: prepared.appointment.id,
      googleEventId: result.googleEventId,
    }),
  );
};

export const handleCalendarDelete: OutboxHandler = async (_db, event) => {
  const prepared = await prepareCalendarDelete(event);
  await callCalendarDelete(prepared);
  await finalizeCalendarDelete(prepared.appointmentId);
  console.log(
    JSON.stringify({
      level: "info",
      msg: "calendar.delete.done",
      eventId: event.id,
      appointmentId: prepared.appointmentId,
      skipped: prepared.action === "skip",
    }),
  );
};
