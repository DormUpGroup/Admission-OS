import type { OutboxHandler } from "../dispatch";
import { queueIntakeRunForMessageReceived } from "@/server/automation/runs";
import {
  callTelegramDelivery,
  finalizeTelegramDelivery,
  prepareTelegramDelivery,
  TelegramRetryableError,
} from "@/server/delivery/telegram";

export const handleTelegramSend: OutboxHandler = async (_db, event) => {
  const prepared = await prepareTelegramDelivery(event);

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
    const outcome = await finalizeTelegramDelivery(prepared, { error });
    if (outcome === "retry" || error instanceof TelegramRetryableError) {
      throw error instanceof Error ? error : new Error(String(error));
    }
    // Ambiguous / unknown: outbox completes without automatic resend.
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
