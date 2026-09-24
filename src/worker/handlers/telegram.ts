import type { OutboxHandler } from "../dispatch";
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

export const handleMessageReceived: OutboxHandler = async (_db, event) => {
  // Phase 1 stub — Hermes create_run lands in PR4.
  console.log(
    JSON.stringify({
      level: "info",
      msg: "message.received.stub",
      eventId: event.id,
      idempotencyKey: event.idempotencyKey,
      payload: event.payloadJson,
      at: new Date().toISOString(),
    }),
  );
};
