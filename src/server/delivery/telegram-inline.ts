import { randomUUID } from "crypto";
import { prisma } from "@/lib/db";
import {
  completeOutboxEvent,
  DEFAULT_LEASE_MS,
  isAutomationEnabled,
  OUTBOX_STATUS,
  retryOutboxEvent,
} from "@/server/commands/outbox";
import { handleTelegramSend } from "@/worker/handlers/telegram";

export type InlineDeliverResult =
  | { status: "skipped"; reason: "automation_off" | "no_token" | "not_found" | "lost_lease" }
  | { status: "delivered" }
  | { status: "deferred"; error: string };

/**
 * Claim a pending telegram.send outbox row and deliver immediately from the web
 * process so admin replies do not wait for the worker idle poll.
 * On failure, re-queues for the worker (does not throw to the UI).
 */
export async function tryDeliverTelegramSendNow(
  messageId: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<InlineDeliverResult> {
  if (!isAutomationEnabled(env)) {
    return { status: "skipped", reason: "automation_off" };
  }
  if (!env.TELEGRAM_BOT_TOKEN?.trim()) {
    return { status: "skipped", reason: "no_token" };
  }

  const idempotencyKey = `telegram.send:${messageId}`;
  const now = new Date();
  const leaseToken = randomUUID();
  const leaseExpiresAt = new Date(now.getTime() + DEFAULT_LEASE_MS);
  const workerId = `web-inline-${leaseToken.slice(0, 8)}`;

  const claimed = await prisma.outboxEvent.updateMany({
    where: {
      idempotencyKey,
      OR: [
        { status: OUTBOX_STATUS.PENDING },
        {
          status: OUTBOX_STATUS.PROCESSING,
          leaseExpiresAt: { lt: now },
        },
      ],
    },
    data: {
      status: OUTBOX_STATUS.PROCESSING,
      lockedBy: workerId,
      lockedAt: now,
      leaseToken,
      leaseExpiresAt,
    },
  });

  if (claimed.count === 0) {
    const existing = await prisma.outboxEvent.findUnique({
      where: { idempotencyKey },
    });
    if (!existing) {
      return { status: "skipped", reason: "not_found" };
    }
    // Already claimed by worker or completed — leave alone.
    return { status: "skipped", reason: "lost_lease" };
  }

  const event = await prisma.outboxEvent.findUnique({
    where: { idempotencyKey },
  });
  if (!event || event.leaseToken !== leaseToken) {
    return { status: "skipped", reason: "lost_lease" };
  }

  try {
    await handleTelegramSend(prisma, event);
    await completeOutboxEvent(prisma, event.id, leaseToken, { now: new Date() });
    return { status: "delivered" };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await retryOutboxEvent(prisma, event.id, leaseToken, message);
    console.warn(
      JSON.stringify({
        level: "warn",
        msg: "telegram.send.inline_deferred",
        messageId,
        eventId: event.id,
        error: message,
      }),
    );
    return { status: "deferred", error: message };
  }
}
