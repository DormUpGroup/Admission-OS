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
import { promotionStudentEmail, resolveConsultationEmail } from "@/server/registration/contact";
import { enqueueOutbox } from "@/server/commands/outbox";
import { attachLeadAppointmentsToStudent } from "@/server/commands/appointments";
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

function isNextRedirect(error: unknown) {
  return (
    typeof error === "object" &&
    error !== null &&
    "digest" in error &&
    typeof (error as { digest: unknown }).digest === "string" &&
    String((error as { digest: string }).digest).startsWith("NEXT_REDIRECT")
  );
}

export type PromoteLeadResult =
  | { studentId: string; warning?: string }
  | { error: string };

/**
 * Curator or admin only (requireStaff). Turns the lead on this chat into a student
 * and moves the thread into the students list. The cabinet is the email the lead
 * left when booking the consultation.
 */
export async function promoteLeadToStudentAction(
  conversationId: string,
): Promise<PromoteLeadResult> {
  try {
    return await promoteLead(conversationId);
  } catch (error) {
    if (isNextRedirect(error)) throw error;
    console.error(error);
    return { error: "Не удалось сделать учеником. Попробуйте ещё раз." };
  }
}

async function promoteLead(conversationId: string): Promise<PromoteLeadResult> {
  const session = await requireStaff();
  const id = conversationId.trim();
  if (!id) return { error: "Диалог не найден" };

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
    return { error: "Диалог не найден" };
  }
  if (conversation.studentId) {
    const convertedLead = await prisma.lead.findFirst({
      where: { convertedStudentId: conversation.studentId },
      select: { id: true },
    });
    if (convertedLead) {
      await attachLeadAppointmentsToStudent(
        prisma,
        convertedLead.id,
        conversation.studentId,
      );
    }
    return finalizePromotion(conversation.studentId);
  }

  const lead = conversation.lead;
  if (!lead) return { error: "У этого диалога нет лида" };
  if (lead.convertedStudentId) {
    await prisma.$transaction(async (tx) => {
      await tx.conversation.updateMany({
        where: { leadId: lead.id },
        data: { studentId: lead.convertedStudentId, leadId: null, inboxFolder: null },
      });
      await attachLeadAppointmentsToStudent(tx, lead.id, lead.convertedStudentId!);
    });
    return finalizePromotion(lead.convertedStudentId);
  }

  const displayName = lead.channelIdentities[0]?.displayName?.trim() ?? "";
  const nameParts = displayName.split(/\s+/).filter(Boolean);
  const firstName = lead.firstName?.trim() || nameParts[0] || "Без имени";
  const lastName =
    lead.lastName?.trim() || (nameParts.length > 1 ? nameParts.slice(1).join(" ") : "—");
  const intake = factText(lead.qualificationJson, "desiredIntake") ?? "не указан";
  const consultationEmail = await resolveConsultationEmail(lead.id);
  const emailTaken = consultationEmail
    ? await prisma.student.findUnique({
        where: { email: consultationEmail },
        select: { id: true },
      })
    : null;
  const chosen = promotionStudentEmail({
    consultationEmail,
    emailTaken: Boolean(emailTaken),
  });
  if ("error" in chosen) return chosen;
  const email = chosen.email;

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
        email,
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
    await attachLeadAppointmentsToStudent(tx, lead.id, created.id);
    return created;
  });

  await enqueueOutbox(prisma, {
    aggregateType: "Student",
    aggregateId: student.id,
    eventType: "client.activated",
    payload: { studentId: student.id, conversationId: id, reason: "curator_promoted" },
    idempotencyKey: `client.activated:${student.id}`,
  });
  return finalizePromotion(student.id);
}

async function finalizePromotion(studentId: string): Promise<PromoteLeadResult> {
  try {
    const delivery = await sendRegistrationInviteOnce(studentId);
    if (delivery.emailError) {
      return {
        studentId,
        warning: delivery.telegramed
          ? `Ссылка ушла в Telegram, но не на почту: ${delivery.emailError}`
          : delivery.emailError,
      };
    }
    return { studentId };
  } catch (error) {
    console.error(error);
    return {
      error:
        error instanceof Error
          ? error.message
          : "Не удалось отправить ссылку на кабинет.",
    };
  }
}
