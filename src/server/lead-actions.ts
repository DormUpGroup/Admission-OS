"use server";

import { Prisma } from "@prisma/client";
import { after } from "next/server";
import { prisma } from "@/lib/db";
import { requireStaff } from "@/server/auth/guards";
import { enqueueOutbox } from "@/server/commands/outbox";

/**
 * Staff only. Removes the lead card, Telegram thread, messages, and consultation
 * bookings. A lead who is already a student is left alone: that history lives
 * on the student.
 *
 * The card disappears in this request. Scanning webhook logs and notifications
 * continues after the response, so the button does not wait on it.
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
      conversations: { select: { id: true } },
      appointments: { select: { id: true, googleEventId: true } },
    },
  });
  if (!lead) throw new Error("Лид не найден");
  if (lead.convertedStudentId) {
    throw new Error("Этот человек уже ученик. Его история хранится в карточке ученика.");
  }

  const conversationIds = lead.conversations.map((conversation) => conversation.id);
  const appointmentIds = lead.appointments.map((appointment) => appointment.id);
  const chatIds = lead.channelIdentities
    .map((identity) => identity.externalId.trim())
    .filter((externalId) => /^\d{5,}$/.test(externalId));

  await prisma.$transaction(
    async (tx) => {
    if (conversationIds.length > 0) {
      await tx.$executeRaw`
        DELETE FROM "AgentRun"
        WHERE "parentRunId" IS NOT NULL
          AND "conversationId" IN (${Prisma.join(conversationIds)})
      `;
      await tx.$executeRaw`
        DELETE FROM "AgentRun"
        WHERE "parentRunId" IS NOT NULL
          AND "subjectId" IN (${Prisma.join(conversationIds)})
      `;
      await tx.$executeRaw`
        DELETE FROM "AgentRun"
        WHERE "parentRunId" IS NOT NULL
          AND "subjectId" IN (
            SELECT id FROM "ConversationMessage"
            WHERE "conversationId" IN (${Prisma.join(conversationIds)})
          )
      `;
      await tx.$executeRaw`
        DELETE FROM "AgentRun"
        WHERE "conversationId" IN (${Prisma.join(conversationIds)})
      `;
      await tx.$executeRaw`
        DELETE FROM "AgentRun"
        WHERE "subjectId" IN (${Prisma.join(conversationIds)})
          OR "subjectId" = ${lead.id}
      `;
      await tx.$executeRaw`
        DELETE FROM "AgentRun"
        WHERE "subjectId" IN (
          SELECT id FROM "ConversationMessage"
          WHERE "conversationId" IN (${Prisma.join(conversationIds)})
        )
      `;
      await tx.$executeRaw`
        DELETE FROM "ApprovalRequest"
        WHERE "subjectId" IN (${Prisma.join(conversationIds)})
          OR "subjectId" = ${lead.id}
      `;
      await tx.$executeRaw`
        DELETE FROM "ApprovalRequest"
        WHERE "subjectId" IN (
          SELECT id FROM "ConversationMessage"
          WHERE "conversationId" IN (${Prisma.join(conversationIds)})
        )
      `;
      await tx.$executeRaw`
        DELETE FROM "DeliveryAttempt"
        WHERE "messageId" IN (
          SELECT id FROM "ConversationMessage"
          WHERE "conversationId" IN (${Prisma.join(conversationIds)})
        )
      `;
      await tx.$executeRaw`
        DELETE FROM "OutboxEvent"
        WHERE "aggregateId" IN (${Prisma.join(conversationIds)})
          OR "aggregateId" = ${lead.id}
      `;
      await tx.$executeRaw`
        DELETE FROM "OutboxEvent"
        WHERE "aggregateId" IN (
          SELECT id FROM "ConversationMessage"
          WHERE "conversationId" IN (${Prisma.join(conversationIds)})
        )
      `;
    } else {
      await tx.agentRun.deleteMany({ where: { subjectId: lead.id } });
      await tx.approvalRequest.deleteMany({ where: { subjectId: lead.id } });
      await tx.outboxEvent.deleteMany({ where: { aggregateId: lead.id } });
    }

    if (appointmentIds.length > 0) {
      await tx.$executeRaw`
        DELETE FROM "ApprovalRequest" WHERE "subjectId" IN (${Prisma.join(appointmentIds)})
      `;
      await tx.$executeRaw`
        DELETE FROM "OutboxEvent" WHERE "aggregateId" IN (${Prisma.join(appointmentIds)})
      `;
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
  },
    { maxWait: 10_000, timeout: 20_000 },
  );

  const markers = [...conversationIds, ...appointmentIds];
  if (chatIds.length > 0 || markers.length > 0) {
    after(async () => {
      await purgeLeadTraces({ chatIds, markers });
    });
  }
}

/** Webhook copies and in-app notices have no foreign key to the lead. */
async function purgeLeadTraces(input: { chatIds: string[]; markers: string[] }) {
  try {
    for (const chatId of input.chatIds) {
      await prisma.inboxEvent.deleteMany({
        where: { payloadJson: { string_contains: chatId } },
      });
    }
    for (const marker of input.markers) {
      await prisma.inAppNotification.deleteMany({
        where: { metadataJson: { contains: marker } },
      });
    }
  } catch (error) {
    console.error("lead.purge_traces_failed", error);
  }
}
