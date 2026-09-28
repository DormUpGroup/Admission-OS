import type { OutboxHandler } from "../dispatch";
import { deliverMeetingLinkNotice } from "@/server/commands/appointments";
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
  if (prepared.action === "skip" || !prepared.appointment) {
    console.log(
      JSON.stringify({
        level: "info",
        msg: "calendar.upsert.skipped",
        eventId: event.id,
        reason: prepared.appointment ? "cancelled" : "missing",
      }),
    );
    return;
  }
  const result = await callCalendarUpsert(prepared);
  const saved = await finalizeCalendarUpsert(
    prepared.appointment.id,
    result.googleEventId,
    result.meetingUrl,
  );
  if (saved?.meetingUrl) {
    await deliverMeetingLinkNotice(saved.id);
  }
  if (!saved) {
    console.warn(
      JSON.stringify({
        level: "warn",
        msg: "calendar.upsert.appointment_missing",
        eventId: event.id,
        appointmentId: prepared.appointment.id,
        googleEventId: result.googleEventId,
      }),
    );
    return;
  }
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
