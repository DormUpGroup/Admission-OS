"use server";

import { prisma } from "@/lib/db";
import { requireStaff } from "@/server/auth/guards";
import { enqueueOutbox } from "@/server/commands/outbox";

/**
 * Staff only. Removes the lead card, Telegram thread, messages, and consultation
 * bookings. A lead who is already a student is left alone: that history lives
 * on the student.
 */
export async function deleteLeadAction(leadId: string): Promise<void> {
  await requireStaff();
  const id = leadId.trim();
  if (!id) throw new Error("Лид не найден");

  const lead = await prisma.lead.findUnique({
    where: { id },
    select: {
      id: true,
      convertedStudentId: true,
      channelIdentities: { select: { externalId: true } },
      conversations: {
        select: { id: true, messages: { select: { id: true } } },
      },
      appointments: {
        select: { id: true, googleEventId: true },
      },
    },
  });
  if (!lead) throw new Error("Лид не найден");
  if (lead.convertedStudentId) {
    throw new Error("Этот человек уже ученик. Его история хранится в карточке ученика.");
  }

  const conversationIds = lead.conversations.map((conversation) => conversation.id);
  const messageIds = lead.conversations.flatMap((conversation) =>
    conversation.messages.map((message) => message.id),
  );
  const appointmentIds = lead.appointments.map((appointment) => appointment.id);
  const subjectIds = [lead.id, ...conversationIds, ...messageIds, ...appointmentIds];
  const chatIds = lead.channelIdentities
    .map((identity) => identity.externalId.trim())
    .filter((externalId) => /^\d{5,}$/.test(externalId));

  await prisma.$transaction(async (tx) => {
    await tx.approvalRequest.deleteMany({ where: { subjectId: { in: subjectIds } } });

    const runWhere = {
      OR: [
        ...(conversationIds.length > 0
          ? [{ conversationId: { in: conversationIds } }]
          : []),
        { subjectId: { in: subjectIds } },
      ],
    };
    await tx.agentRun.deleteMany({
      where: { ...runWhere, parentRunId: { not: null } },
    });
    await tx.agentRun.deleteMany({ where: runWhere });

    const aggregateIds = [lead.id, ...conversationIds, ...messageIds, ...appointmentIds];
    const outboxRows = await tx.outboxEvent.findMany({
      where: { aggregateId: { in: aggregateIds } },
      select: { id: true },
    });
    const outboxIds = outboxRows.map((row) => row.id);
    if (messageIds.length > 0 || outboxIds.length > 0) {
      await tx.deliveryAttempt.deleteMany({
        where: {
          OR: [
            ...(messageIds.length > 0 ? [{ messageId: { in: messageIds } }] : []),
            ...(outboxIds.length > 0 ? [{ outboxEventId: { in: outboxIds } }] : []),
          ],
        },
      });
    }
    await tx.outboxEvent.deleteMany({ where: { aggregateId: { in: aggregateIds } } });

    for (const marker of [...appointmentIds, ...conversationIds]) {
      await tx.inAppNotification.deleteMany({
        where: { metadataJson: { contains: marker } },
      });
    }
    for (const chatId of chatIds) {
      await tx.inboxEvent.deleteMany({
        where: { payloadJson: { string_contains: chatId } },
      });
    }

    for (const appointment of lead.appointments) {
      if (!appointment.googleEventId) continue;
      await enqueueOutbox(tx, {
        aggregateType: "Appointment",
        aggregateId: appointment.id,
        eventType: "calendar.delete",
        payload: {
          appointmentId: appointment.id,
          googleEventId: appointment.googleEventId,
        },
        idempotencyKey: `calendar.delete:lead:${appointment.id}`,
      });
    }

    await tx.lead.delete({ where: { id: lead.id } });
  });
}
