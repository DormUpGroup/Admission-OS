import type { OutboxHandler } from "../dispatch";
import {
  queueOnboardingRunForClientActivated,
  queueSchedulingRunForBooking,
} from "@/server/automation/runs";

export const handleSchedulingRequested: OutboxHandler = async (db, event) => {
  const result = await queueSchedulingRunForBooking(db, event);
  console.log(
    JSON.stringify({
      level: "info",
      msg: result.queued ? "scheduling.requested.queued" : "scheduling.requested.skipped",
      eventId: event.id,
      result,
      at: new Date().toISOString(),
    }),
  );
};

export const handleClientActivated: OutboxHandler = async (db, event) => {
  const result = await queueOnboardingRunForClientActivated(db, event);
  console.log(
    JSON.stringify({
      level: "info",
      msg: result.queued ? "client.activated.queued" : "client.activated.skipped",
      eventId: event.id,
      result,
      at: new Date().toISOString(),
    }),
  );
};
