"use server";

import { prisma } from "@/lib/db";
import { requireStaff } from "@/server/auth/guards";
import { requestTelegramSend } from "@/server/commands/telegram-outbound";
import { tryDeliverTelegramSendNow } from "@/server/delivery/telegram-inline";

export type SendTelegramInboxReplyResult = {
  messageId: string;
  conversationId: string;
  body: string;
  createdAt: string;
  deliveryStatus: string;
  duplicate: boolean;
};

export async function sendTelegramInboxReplyAction(
  formData: FormData,
): Promise<SendTelegramInboxReplyResult> {
  const session = await requireStaff();
  const conversationId = String(formData.get("conversationId") ?? "").trim();
  const body = String(formData.get("body") ?? "").trim();

  if (!conversationId || !body) {
    throw new Error("Укажите текст ответа");
  }

  const { message, duplicate } = await requestTelegramSend({
    conversationId,
    body,
    senderUserId: session.user.id,
    clientRequestId: `admin-inbox:${conversationId}:${Date.now()}`,
  });

  let deliveryStatus = message.deliveryStatus;
  if (!duplicate) {
    // Await Telegram here. after() dropped the promise, so the reply stayed
    // PENDING in the UI while the client never received it.
    await tryDeliverTelegramSendNow(message.id);
    const fresh = await prisma.conversationMessage.findUnique({
      where: { id: message.id },
      select: { deliveryStatus: true },
    });
    if (fresh) deliveryStatus = fresh.deliveryStatus;
  }

  return {
    messageId: message.id,
    conversationId,
    body: message.body ?? body,
    createdAt: message.createdAt.toISOString(),
    deliveryStatus,
    duplicate,
  };
}
