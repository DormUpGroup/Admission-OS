import { prisma } from "@/lib/db";
import { enqueueOutbox, type DbClient } from "@/server/commands/outbox";
import type { Prisma } from "@prisma/client";

export type TelegramInlineKeyboard = {
  inline_keyboard: Array<
    Array<{ text: string; callback_data: string }>
  >;
};

export type RequestTelegramSendInput = {
  conversationId: string;
  body: string;
  senderUserId?: string | null;
  clientRequestId?: string;
  replyMarkup?: TelegramInlineKeyboard | null;
  /** When set, run inside this transaction (caller already holds conversation). */
  tx?: DbClient;
};

export async function requestTelegramSend(input: RequestTelegramSendInput) {
  const body = input.body.trim();
  if (!body) {
    throw new Error("Message body is required");
  }

  const db: DbClient = input.tx ?? prisma;

  const conversation = await db.conversation.findUnique({
    where: { id: input.conversationId },
  });
  if (!conversation) {
    throw new Error("Conversation not found");
  }
  if (conversation.channel !== "TELEGRAM") {
    throw new Error("Conversation is not a Telegram channel");
  }

  const clientRequestId =
    input.clientRequestId ??
    `telegram-send:${input.conversationId}:${Date.now()}`;

  const run = async (tx: DbClient) => {
    const existing = input.clientRequestId
      ? await tx.conversationMessage.findUnique({
          where: { clientRequestId: input.clientRequestId },
        })
      : null;
    if (existing) {
      return { message: existing, duplicate: true as const };
    }

    const attachmentsJson = input.replyMarkup
      ? ({ reply_markup: input.replyMarkup } as Prisma.InputJsonValue)
      : undefined;

    const message = await tx.conversationMessage.create({
      data: {
        conversationId: input.conversationId,
        clientRequestId,
        direction: "OUTBOUND",
        senderType: "STAFF",
        senderUserId: input.senderUserId ?? null,
        body,
        attachmentsJson,
        deliveryStatus: "PENDING",
        policyStatus: "APPROVED",
      },
    });

    const now = new Date();
    await tx.conversation.update({
      where: { id: input.conversationId },
      data: { lastOutboundAt: now, staffLastReadAt: now },
    });

    await enqueueOutbox(tx, {
      aggregateType: "ConversationMessage",
      aggregateId: message.id,
      eventType: "telegram.send",
      payload: {
        messageId: message.id,
        conversationId: input.conversationId,
        ...(input.replyMarkup ? { replyMarkup: input.replyMarkup } : {}),
      },
      idempotencyKey: `telegram.send:${message.id}`,
    });

    return { message, duplicate: false as const };
  };

  if (input.tx) {
    return run(input.tx);
  }

  return prisma.$transaction(async (tx) => run(tx));
}
