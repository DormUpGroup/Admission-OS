import type { OutboxEvent } from "@prisma/client";
import {
  shouldProcessOutboxEvent,
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
  options?: { automationEnabled?: boolean },
): Promise<void> {
  const automationEnabled = options?.automationEnabled ?? false;
  if (!(await shouldProcessOutboxEvent(db, event, automationEnabled))) {
    throw new Error(
      `Event type "${event.eventType}" blocked by automation kill-switch`,
    );
  }

  const handler = handlers.get(event.eventType);
  if (!handler) {
    throw new Error(`No handler registered for event type "${event.eventType}"`);
  }

  await handler(db, event);
}
