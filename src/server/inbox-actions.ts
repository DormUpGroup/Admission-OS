"use server";

import { revalidatePath } from "next/cache";
import { requireStaff } from "@/server/auth/guards";
import { requestTelegramSend } from "@/server/commands/telegram-outbound";
import { tryDeliverTelegramSendNow } from "@/server/delivery/telegram-inline";

export async function sendTelegramInboxReplyAction(formData: FormData) {
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

  if (!duplicate) {
    await tryDeliverTelegramSendNow(message.id);
  }

  revalidatePath("/admin/messages/telegram");
}
