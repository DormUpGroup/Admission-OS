import { prisma } from "@/lib/db";
import { parseTelegramBotCommand, telegramWelcomeText } from "@/server/channels/telegram-copy";
import type { NormalizedTelegramMessage } from "@/server/channels/telegram";
import { isEnvAutomationEnabled, resolveAutomationEnabled } from "@/server/commands/outbox";
import { DELIVERY_STATUS, sendTelegramChatText } from "@/server/delivery/telegram";

const CHANNEL = "TELEGRAM";

export type InstantWelcome = {
  /** Already in flight. Do not await this before ingest. */
  delivery: Promise<{ ok: true; providerMessageId: string } | { ok: false; error: string }>;
};

async function hasRecordedWelcome(externalUserId: string): Promise<boolean> {
  const identity = await prisma.channelIdentity.findUnique({
    where: {
      channel_externalId: { channel: CHANNEL, externalId: externalUserId },
    },
    select: { leadId: true, studentId: true },
  });
  if (!identity?.leadId && !identity?.studentId) return false;

  const conversation = await prisma.conversation.findFirst({
    where: {
      channel: CHANNEL,
      status: "OPEN",
      ...(identity.leadId ? { leadId: identity.leadId } : { studentId: identity.studentId! }),
    },
    orderBy: { createdAt: "desc" },
    select: { id: true },
  });
  if (!conversation) return false;

  const welcome = await prisma.conversationMessage.findUnique({
    where: { clientRequestId: `telegram:welcome:${conversation.id}` },
    select: { id: true },
  });
  return Boolean(welcome);
}

/**
 * Posts the fixed greeting (name + template) without waiting for the ingest
 * transaction. Returns null when this /start should stay on the normal path.
 */
export async function beginInstantWelcome(
  message: NormalizedTelegramMessage,
): Promise<InstantWelcome | null> {
  if (parseTelegramBotCommand(message.text) !== "start") return null;
  if (!isEnvAutomationEnabled()) return null;
  if (!process.env.TELEGRAM_BOT_TOKEN?.trim()) return null;

  const [enabled, already, inbox] = await Promise.all([
    resolveAutomationEnabled(prisma),
    hasRecordedWelcome(message.externalUserId),
    prisma.inboxEvent.findUnique({
      where: {
        provider_providerEventId: {
          provider: CHANNEL,
          providerEventId: message.providerEventId,
        },
      },
      select: { id: true },
    }),
  ]);
  if (!enabled || already || inbox) return null;

  const delivery = sendTelegramChatText(
    message.externalChatId,
    telegramWelcomeText(message.displayName),
  )
    .then((providerMessageId) => ({ ok: true as const, providerMessageId }))
    .catch((error: unknown) => ({
      ok: false as const,
      error: error instanceof Error ? error.message : String(error),
    }));

  return { delivery };
}

/** After ingest commits, keep the early greeting from being sent a second time. */
export async function finishInstantWelcome(
  instant: InstantWelcome,
  welcomeMessageId: string | null,
): Promise<void> {
  const outcome = await instant.delivery;
  if (!welcomeMessageId) return;

  if (!outcome.ok) {
    // A timeout may already have reached Telegram. Leave the hold so the worker
    // does not immediately send a second copy. A definite rejection can go now.
    if (/abort|timeout|fetch failed|network/i.test(outcome.error)) return;
    await prisma.outboxEvent.updateMany({
      where: {
        idempotencyKey: `telegram.send:${welcomeMessageId}`,
        status: "PENDING",
      },
      data: { nextAttemptAt: new Date() },
    });
    return;
  }

  await prisma.$transaction(async (tx) => {
    await tx.conversationMessage.update({
      where: { id: welcomeMessageId },
      data: {
        deliveryStatus: DELIVERY_STATUS.SENT,
        providerMessageId: outcome.providerMessageId,
        sentAt: new Date(),
      },
    });
    const prior = await tx.deliveryAttempt.findFirst({
      where: { messageId: welcomeMessageId, provider: CHANNEL, status: DELIVERY_STATUS.SENT },
      select: { id: true },
    });
    if (!prior) {
      const latest = await tx.deliveryAttempt.findFirst({
        where: { messageId: welcomeMessageId, provider: CHANNEL },
        orderBy: { attempt: "desc" },
        select: { attempt: true },
      });
      await tx.deliveryAttempt.create({
        data: {
          messageId: welcomeMessageId,
          provider: CHANNEL,
          attempt: (latest?.attempt ?? 0) + 1,
          status: DELIVERY_STATUS.SENT,
          providerResponseId: outcome.providerMessageId,
        },
      });
    }
  });
}
