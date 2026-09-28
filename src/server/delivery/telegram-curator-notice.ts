import { prisma } from "@/lib/db";
import { formatCuratorAutomationNotice } from "@/server/automation/curator-notice";
import { createInAppNotification } from "@/server/services/notifications";

const NOTICE_TYPE = "automation.telegram_undeliverable";

/** Curator must reply by hand when Telegram has no chat id for this contact. */
export async function notifyCuratorTelegramSendFailed(messageId: string): Promise<void> {
  const message = await prisma.conversationMessage.findUnique({
    where: { id: messageId },
    select: {
      id: true,
      conversation: {
        select: {
          id: true,
          assignedCuratorId: true,
          lead: { select: { assignedCuratorId: true, firstName: true, lastName: true } },
          student: {
            select: { id: true, curatorId: true, firstName: true, lastName: true },
          },
        },
      },
    },
  });
  if (!message) return;

  const conversation = message.conversation;
  const curatorId =
    conversation.assignedCuratorId ??
    conversation.lead?.assignedCuratorId ??
    conversation.student?.curatorId ??
    null;
  if (!curatorId) return;

  const already = await prisma.inAppNotification.findFirst({
    where: {
      userId: curatorId,
      type: NOTICE_TYPE,
      metadataJson: { contains: message.id },
    },
    select: { id: true },
  });
  if (already) return;

  const person = conversation.student ?? conversation.lead;
  const clientName = [person?.firstName, person?.lastName].filter(Boolean).join(" ");
  const notice = formatCuratorAutomationNotice({
    clientName,
    problem: "бот не отправил сообщение, потому что у контакта в Telegram нет chat_id.",
    action: "откройте переписку и ответьте клиенту вручную.",
  });
  await createInAppNotification({
    userId: curatorId,
    studentId: conversation.student?.id ?? null,
    type: NOTICE_TYPE,
    title: notice.title,
    body: notice.body,
    metadata: { conversationId: conversation.id, messageId: message.id },
  });
}
