import type { OutboxEvent } from "@prisma/client";
import {
  isEventTypeAllowed,
  type DbClient,
} from "@/server/commands/outbox";

export type OutboxHandler = (
  db: DbClient,
  event: OutboxEvent,
) => Promise<void>;

const handlers = new Map<string, OutboxHandler>();

export function registerOutboxHandler(
  eventType: string,
  handler: OutboxHandler,
): void {
  handlers.set(eventType, handler);
}

export function getOutboxHandler(eventType: string): OutboxHandler | undefined {
  return handlers.get(eventType);
}

export async function dispatchOutboxEvent(
  db: DbClient,
  event: OutboxEvent,
  env: NodeJS.ProcessEnv = process.env,
): Promise<void> {
  if (!isEventTypeAllowed(event.eventType, env)) {
    throw new Error(
      `Event type "${event.eventType}" blocked by AUTOMATION_ENABLED=false`,
    );
  }

  const handler = handlers.get(event.eventType);
  if (!handler) {
    throw new Error(`No handler registered for event type "${event.eventType}"`);
  }

  await handler(db, event);
}
