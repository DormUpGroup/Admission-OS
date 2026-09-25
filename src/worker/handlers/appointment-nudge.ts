import type { OutboxEvent } from "@prisma/client";
import { prisma } from "@/lib/db";
import type { DbClient } from "@/server/commands/outbox";
import { enqueueOutbox } from "@/server/commands/outbox";
import { requestTelegramSend } from "@/server/commands/telegram-outbound";
import { APPOINTMENT_STATUS } from "@/server/commands/appointments";
import { formatSlotLabel } from "@/server/services/appointments/slots";
import { createInAppNotification } from "@/server/services/notifications";
import type { OutboxHandler } from "../dispatch";

const MAX_NUDGES = 24;

/**
 * Hourly client nudge while appointment awaits confirmation.
 * After the first missed hour, notify the curator once.
 */
export const handleAppointmentClientNudge: OutboxHandler = async (
  _db: DbClient,
  event: OutboxEvent,
): Promise<void> => {
  const payload = event.payloadJson;
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new Error("appointment.client_nudge payload must be an object");
  }
  const appointmentId = String(
    (payload as { appointmentId?: unknown }).appointmentId ?? "",
  );
  const nudgeIndex = Number(
    (payload as { nudgeIndex?: unknown }).nudgeIndex ?? 1,
  );
  const version = Number((payload as { version?: unknown }).version ?? 0);
  if (!appointmentId) {
    throw new Error("appointment.client_nudge requires appointmentId");
  }

  const appointment = await prisma.appointment.findUnique({
    where: { id: appointmentId },
  });
  if (!appointment) return;

  if (appointment.status === APPOINTMENT_STATUS.CANCELLED) return;
  if (!appointment.confirmationToken) return;
  if (version > 0 && appointment.version !== version) return;
  if (
    appointment.status === APPOINTMENT_STATUS.CONFIRMED &&
    !appointment.pendingStartsAt
  ) {
    return;
  }

  const proposed = appointment.pendingStartsAt ?? appointment.startsAt;
  const when = formatSlotLabel(proposed, appointment.timezone);

  if (appointment.conversationId) {
    const conversation = await prisma.conversation.findUnique({
      where: { id: appointment.conversationId },
      select: { channel: true },
    });
    if (conversation?.channel === "TELEGRAM") {
      await requestTelegramSend({
        conversationId: appointment.conversationId,
        body: `Напоминание: подтвердите консультацию «${appointment.title}»\n${when}\nНажмите кнопку в предыдущем сообщении или напишите куратору.`,
        clientRequestId: `appt-nudge:${appointment.id}:${nudgeIndex}`,
      });
      await prisma.appointment.update({
        where: { id: appointment.id },
        data: { lastClientNudgeAt: new Date() },
      });
    }
  }

  if (nudgeIndex === 1 && !appointment.curatorNudgeSentAt) {
    if (appointment.assignedCuratorId) {
      await createInAppNotification({
        userId: appointment.assignedCuratorId,
        studentId: appointment.studentId,
        type: "appointment.awaiting_client",
        title: "Клиент не подтвердил консультацию",
        body: `«${appointment.title}» на ${when} — нет ответа уже ~1 час.`,
        metadata: { appointmentId: appointment.id },
      });
      await prisma.appointment.update({
        where: { id: appointment.id },
        data: { curatorNudgeSentAt: new Date() },
      });
    }
  }

  if (nudgeIndex < MAX_NUDGES) {
    const v = version > 0 ? version : appointment.version;
    await enqueueOutbox(prisma, {
      aggregateType: "Appointment",
      aggregateId: appointment.id,
      eventType: "appointment.client_nudge",
      payload: {
        appointmentId: appointment.id,
        nudgeIndex: nudgeIndex + 1,
        version: v,
      },
      idempotencyKey: `appt.nudge:${appointment.id}:v${v}:${nudgeIndex + 1}`,
      nextAttemptAt: new Date(Date.now() + 60 * 60 * 1000),
    });
  }
};
