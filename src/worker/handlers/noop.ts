import type { OutboxHandler } from "../dispatch";

export const handleNoop: OutboxHandler = async (_db, event) => {
  // Intentional no-op for claim/dispatch plumbing tests.
  void event;
};

export const handleWorkerLog: OutboxHandler = async (_db, event) => {
  const payload = event.payloadJson;
  const message =
    payload &&
    typeof payload === "object" &&
    !Array.isArray(payload) &&
    "message" in payload
      ? String((payload as { message: unknown }).message)
      : JSON.stringify(payload);

  console.log(
    JSON.stringify({
      level: "info",
      msg: "outbox.worker.log",
      eventId: event.id,
      eventType: event.eventType,
      idempotencyKey: event.idempotencyKey,
      message,
      at: new Date().toISOString(),
    }),
  );
};
