"use server";

import { after } from "next/server";
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

  // Deliver in background — do not block the curator UI on Telegram RTT.
  if (!duplicate) {
    after(() => {
      void tryDeliverTelegramSendNow(message.id).catch((err) => {
        console.warn(
          JSON.stringify({
            level: "warn",
            msg: "telegram.send.inbox_after_failed",
            messageId: message.id,
            error: err instanceof Error ? err.message : String(err),
          }),
        );
      });
    });
  }

  return {
    messageId: message.id,
    conversationId,
    body: message.body ?? body,
    createdAt: message.createdAt.toISOString(),
    deliveryStatus: message.deliveryStatus,
    duplicate,
  };
}
