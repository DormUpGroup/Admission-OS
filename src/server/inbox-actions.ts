"use server";

import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import {
  parseInboxFolderOverride,
  type ConversationFolder,
} from "@/lib/telegram-conversation-kind";
import { requireStaff } from "@/server/auth/guards";
import {
  applyReplyDraftRevision,
  locateLatestReplyDraft,
} from "@/server/telegram-inbox-query";
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

export async function setTelegramInboxFolderAction(
  conversationId: string,
  folder: ConversationFolder,
): Promise<void> {
  await requireStaff();
  const next = parseInboxFolderOverride(folder);
  if (!conversationId.trim() || !next) {
    throw new Error("Не удалось перенести диалог");
  }

  const conversation = await prisma.conversation.findUnique({
    where: { id: conversationId },
    select: { id: true, channel: true },
  });
  if (!conversation || conversation.channel !== "TELEGRAM") {
    throw new Error("Диалог не найден");
  }

  await prisma.conversation.update({
    where: { id: conversation.id },
    data: { inboxFolder: next },
  });
}

export async function pauseTelegramAutomationAction(conversationId: string): Promise<void> {
  await requireStaff();
  const id = conversationId.trim();
  if (!id) throw new Error("Диалог не найден");

  const conversation = await prisma.conversation.findUnique({
    where: { id },
    select: { id: true, channel: true },
  });
  if (!conversation || conversation.channel !== "TELEGRAM") {
    throw new Error("Диалог не найден");
  }

  await prisma.conversation.update({
    where: { id: conversation.id },
    data: {
      automationPausedAt: new Date(),
      automationPauseReason: "Куратор выключил бота",
    },
  });
}

export async function resumeTelegramAutomationAction(conversationId: string): Promise<void> {
  await requireStaff();
  const id = conversationId.trim();
  if (!id) throw new Error("Диалог не найден");

  const conversation = await prisma.conversation.findUnique({
    where: { id },
    select: { id: true, channel: true },
  });
  if (!conversation || conversation.channel !== "TELEGRAM") {
    throw new Error("Диалог не найден");
  }

  await prisma.conversation.update({
    where: { id: conversation.id },
    data: { automationPausedAt: null, automationPauseReason: null },
  });
}

/** Empty body discards the Hermes draft. Any other text replaces it. */
export async function saveTelegramReplyDraftAction(
  conversationId: string,
  body: string,
): Promise<void> {
  await requireStaff();
  const id = conversationId.trim();
  if (!id) throw new Error("Диалог не найден");

  const conversation = await prisma.conversation.findUnique({
    where: { id },
    select: { id: true, channel: true },
  });
  if (!conversation || conversation.channel !== "TELEGRAM") {
    throw new Error("Диалог не найден");
  }

  const runs = await prisma.agentRun.findMany({
    where: { conversationId: conversation.id },
    orderBy: { createdAt: "desc" },
    take: 8,
    select: { id: true, outputJson: true },
  });
  const located = locateLatestReplyDraft(runs);
  if (!located) return;
  const run = runs.find((item) => item.id === located.runId);
  if (!run) return;
  const next = applyReplyDraftRevision(run.outputJson, located.draftIndex, body);
  if (!next) return;

  await prisma.agentRun.update({
    where: { id: run.id },
    data: { outputJson: next as Prisma.InputJsonValue },
  });
}
