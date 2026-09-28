import type { OutboxHandler } from "../dispatch";
import { queueIntakeRunForMessageReceived } from "@/server/automation/runs";
import {
  callTelegramDelivery,
  finalizeTelegramDelivery,
  prepareTelegramDelivery,
  rethrowTelegramDeliveryFailure,
} from "@/server/delivery/telegram";

export const handleTelegramSend: OutboxHandler = async (_db, event) => {
  const prepared = await prepareTelegramDelivery(event);

  if (prepared.action === "skip_missing") {
    console.log(
      JSON.stringify({
        level: "info",
        msg: "telegram.send.skipped",
        eventId: event.id,
        messageId: prepared.messageId,
        action: prepared.action,
      }),
    );
    return;
  }

  if (prepared.action === "skip_success" || prepared.action === "skip_unknown") {
    await finalizeTelegramDelivery(prepared, {
      skip: prepared.action === "skip_success" ? "success" : "unknown",
    });
    console.log(
      JSON.stringify({
        level: "info",
        msg: "telegram.send.skipped",
        eventId: event.id,
        messageId: prepared.messageId,
        action: prepared.action,
      }),
    );
    return;
  }

  try {
    const result = await callTelegramDelivery(prepared);
    await finalizeTelegramDelivery(prepared, { result });
  } catch (error) {
    await rethrowTelegramDeliveryFailure(prepared, error);
    console.warn(
      JSON.stringify({
        level: "warn",
        msg: "telegram.send.unknown_requires_review",
        eventId: event.id,
        messageId: prepared.messageId,
        error: error instanceof Error ? error.message : String(error),
      }),
    );
  }
};

export const handleMessageReceived: OutboxHandler = async (db, event) => {
  const result = await queueIntakeRunForMessageReceived(db, event);
  console.log(
    JSON.stringify({
      level: "info",
      msg: result.queued ? "message.received.intake_queued" : "message.received.skipped",
      eventId: event.id,
      idempotencyKey: event.idempotencyKey,
      result,
      at: new Date().toISOString(),
    }),
  );
};
