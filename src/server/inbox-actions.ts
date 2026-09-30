"use server";

import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { StudyLevel, type StudyLevel as StudyLevelValue } from "@/lib/enums";
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
import { resolveConsultationEmail } from "@/server/registration/contact";
import { enqueueOutbox } from "@/server/commands/outbox";
import { sendRegistrationInviteOnce } from "@/server/registration/invite";

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

/** Drop a trash override so the thread returns to leads or students. */
export async function restoreTelegramInboxFolderAction(conversationId: string): Promise<void> {
  await requireStaff();
  const id = conversationId.trim();
  if (!id) throw new Error("Диалог не найден");
  await prisma.conversation.updateMany({
    where: { id, channel: "TELEGRAM" },
    data: { inboxFolder: null },
  });
}

function factText(value: Prisma.JsonValue | null, key: string): string | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const raw = (value as Record<string, unknown>)[key];
  if (typeof raw !== "string") return null;
  const text = raw.trim();
  return text || null;
}

function studyLevelFromChat(value: string | null): StudyLevelValue {
  const text = (value ?? "").toLowerCase();
  if (text.includes("маг")) return StudyLevel.MASTER;
  if (text.includes("бакал")) return StudyLevel.BACHELOR;
  if (text.includes("phd") || text.includes("аспиран")) return StudyLevel.PHD;
  if (text.includes("foundation") || text.includes("подготов")) return StudyLevel.FOUNDATION;
  return StudyLevel.OTHER;
}

/**
 * Curator or admin only (requireStaff). Turns the lead on this chat into a student
 * and moves the thread into the students list.
 */
export async function promoteLeadToStudentAction(
  conversationId: string,
): Promise<{ studentId: string }> {
  const session = await requireStaff();
  const id = conversationId.trim();
  if (!id) throw new Error("Диалог не найден");

  const conversation = await prisma.conversation.findUnique({
    where: { id },
    include: {
      lead: {
        include: {
          channelIdentities: {
            where: { channel: "TELEGRAM" },
            select: { displayName: true },
            take: 1,
          },
        },
      },
    },
  });
  if (!conversation || conversation.channel !== "TELEGRAM") {
    throw new Error("Диалог не найден");
  }
  if (conversation.studentId) {
    await sendRegistrationInviteOnce(conversation.studentId);
    return { studentId: conversation.studentId };
  }

  const lead = conversation.lead;
  if (!lead) throw new Error("У этого диалога нет лида");
  if (lead.convertedStudentId) {
    await prisma.conversation.updateMany({
      where: { leadId: lead.id },
      data: { studentId: lead.convertedStudentId, leadId: null, inboxFolder: null },
    });
    await sendRegistrationInviteOnce(lead.convertedStudentId);
    return { studentId: lead.convertedStudentId };
  }

  const displayName = lead.channelIdentities[0]?.displayName?.trim() ?? "";
  const nameParts = displayName.split(/\s+/).filter(Boolean);
  const firstName = lead.firstName?.trim() || nameParts[0] || "Без имени";
  const lastName =
    lead.lastName?.trim() || (nameParts.length > 1 ? nameParts.slice(1).join(" ") : "—");
  const intake = factText(lead.qualificationJson, "desiredIntake") ?? "не указан";
  const email = await resolveConsultationEmail(lead.id);
  if (!email) throw new Error("На заявке нет почты. Сначала запишите консультацию.");
  const emailTaken = await prisma.student.findUnique({
    where: { email },
    select: { id: true },
  });
  if (emailTaken) throw new Error("Эта почта уже есть у другого ученика.");

  const student = await prisma.$transaction(async (tx) => {
    const created = await tx.student.create({
      data: {
        firstName,
        lastName,
        email,
        phone: lead.phone,
        studyLevel: studyLevelFromChat(factText(lead.qualificationJson, "studyLevel")),
        intake,
        targetField: factText(lead.qualificationJson, "targetField"),
        country: factText(lead.qualificationJson, "preferredCountry"),
        preferredLanguage: lead.locale,
        curatorId:
          lead.assignedCuratorId ??
          (session.user.role === "CURATOR" ? session.user.id : null),
      },
    });
    await tx.lead.update({
      where: { id: lead.id },
      data: {
        firstName: lead.firstName ?? firstName,
        lastName: lead.lastName ?? (lastName === "—" ? null : lastName),
        convertedStudentId: created.id,
        convertedAt: new Date(),
        status: "CONVERTED",
      },
    });
    await tx.channelIdentity.updateMany({
      where: { leadId: lead.id },
      data: { studentId: created.id, leadId: null },
    });
    await tx.conversation.updateMany({
      where: { leadId: lead.id },
      data: { studentId: created.id, leadId: null, inboxFolder: null },
    });
    return created;
  });

  await enqueueOutbox(prisma, {
    aggregateType: "Student",
    aggregateId: student.id,
    eventType: "client.activated",
    payload: { studentId: student.id, conversationId: id, reason: "curator_promoted" },
    idempotencyKey: `client.activated:${student.id}`,
  });
  await sendRegistrationInviteOnce(student.id);
  return { studentId: student.id };
}
