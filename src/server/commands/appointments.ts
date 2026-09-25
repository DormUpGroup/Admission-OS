import { randomBytes } from "crypto";
import type { Appointment, Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { enqueueOutbox, type DbClient } from "@/server/commands/outbox";
import {
  requestTelegramSend,
  type TelegramInlineKeyboard,
} from "@/server/commands/telegram-outbound";
import { tryDeliverTelegramSendNow } from "@/server/delivery/telegram-inline";
import {
  APPOINTMENT_TIMEZONE,
  endsAtFromStart,
  formatSlotLabel,
  listOpenSlots,
  parseSlotKey,
  type AppointmentSlot,
} from "@/server/services/appointments/slots";

export const APPOINTMENT_STATUS = {
  AWAITING_CLIENT: "AWAITING_CLIENT",
  PENDING: "PENDING",
  CONFIRMED: "CONFIRMED",
  CANCELLED: "CANCELLED",
} as const;

export type AppointmentCreateInput = {
  clientRequestId: string;
  leadId?: string | null;
  studentId?: string | null;
  conversationId?: string | null;
  assignedCuratorId: string;
  title?: string;
  startsAt: Date;
  endsAt?: Date;
  timezone?: string;
  participantsJson?: Prisma.InputJsonValue;
};

export type AppointmentProposeRescheduleInput = {
  appointmentId: string;
  startsAt: Date;
  endsAt?: Date;
  timezone?: string;
  title?: string;
  /** Curator who initiated the change. Marks the Telegram notice as a staff send. */
  senderUserId?: string | null;
};

export type AppointmentRescheduleInput = AppointmentProposeRescheduleInput;

function newConfirmationToken() {
  return randomBytes(8).toString("hex");
}

async function assertNoCuratorConflict(
  db: DbClient,
  input: {
    curatorId: string;
    startsAt: Date;
    endsAt: Date;
    excludeId?: string;
  },
) {
  const conflict = await db.appointment.findFirst({
    where: {
      assignedCuratorId: input.curatorId,
      status: {
        in: [
          APPOINTMENT_STATUS.AWAITING_CLIENT,
          APPOINTMENT_STATUS.PENDING,
          APPOINTMENT_STATUS.CONFIRMED,
        ],
      },
      ...(input.excludeId ? { id: { not: input.excludeId } } : {}),
      OR: [
        {
          startsAt: { lt: input.endsAt },
          endsAt: { gt: input.startsAt },
        },
        {
          pendingStartsAt: { lt: input.endsAt },
          pendingEndsAt: { gt: input.startsAt },
        },
      ],
    },
    select: { id: true },
  });
  if (conflict) {
    throw new Error("The selected slot is no longer available");
  }
}

function assertValidInterval(startsAt: Date, endsAt: Date) {
  if (!(startsAt instanceof Date) || Number.isNaN(startsAt.getTime())) {
    throw new Error("Invalid startsAt");
  }
  if (!(endsAt instanceof Date) || Number.isNaN(endsAt.getTime())) {
    throw new Error("Invalid endsAt");
  }
  if (endsAt <= startsAt) {
    throw new Error("endsAt must be after startsAt");
  }
}

function confirmKeyboard(token: string, appointmentId: string) {
  return {
    inline_keyboard: [
      [
        {
          text: "Подтвердить",
          callback_data: `a:${appointmentId}:${token}:ok`,
        },
        {
          text: "Другое время",
          callback_data: `a:${appointmentId}:${token}:alt`,
        },
      ],
    ],
  };
}

function altSlotsKeyboard(
  token: string,
  appointmentId: string,
  slots: AppointmentSlot[],
) {
  const rows = slots.slice(0, 8).map((slot) => [
    {
      text: formatSlotLabel(slot.startsAt),
      callback_data: `a:${appointmentId}:${token}:s:${slot.key}`,
    },
  ]);
  rows.push([
    {
      text: "Отмена",
      callback_data: `a:${appointmentId}:${token}:x`,
    },
  ]);
  return { inline_keyboard: rows };
}

async function enqueueClientNudge(
  tx: DbClient,
  appointmentId: string,
  nudgeIndex: number,
  version: number,
) {
  await enqueueOutbox(tx, {
    aggregateType: "Appointment",
    aggregateId: appointmentId,
    eventType: "appointment.client_nudge",
    payload: { appointmentId, nudgeIndex, version },
    idempotencyKey: `appt.nudge:${appointmentId}:v${version}:${nudgeIndex}`,
    nextAttemptAt: new Date(Date.now() + 60 * 60 * 1000),
  });
}

export function formatAppointmentCancelNotice(input: {
  title: string;
  whenLabel: string;
  timezone: string;
}): string {
  return `Консультация «${input.title}» отменена.\n${input.whenLabel} (${input.timezone})`;
}

async function resolveTelegramConversationId(
  tx: DbClient,
  appointment: {
    conversationId: string | null;
    leadId: string | null;
    studentId: string | null;
  },
): Promise<string | null> {
  if (appointment.conversationId) {
    const linked = await tx.conversation.findUnique({
      where: { id: appointment.conversationId },
      select: { id: true, channel: true },
    });
    if (linked?.channel === "TELEGRAM") return linked.id;
  }

  const or: Array<{ leadId: string } | { studentId: string }> = [];
  if (appointment.leadId) or.push({ leadId: appointment.leadId });
  if (appointment.studentId) or.push({ studentId: appointment.studentId });
  if (or.length === 0) return null;

  const open = await tx.conversation.findFirst({
    where: { channel: "TELEGRAM", status: "OPEN", OR: or },
    orderBy: { lastInboundAt: "desc" },
    select: { id: true },
  });
  if (open) return open.id;

  const any = await tx.conversation.findFirst({
    where: { channel: "TELEGRAM", OR: or },
    orderBy: { updatedAt: "desc" },
    select: { id: true },
  });
  return any?.id ?? null;
}

async function notifyClientOnTelegram(
  tx: DbClient,
  appointment: Appointment,
  input: {
    body: string;
    clientRequestId: string;
    senderUserId?: string | null;
    replyMarkup?: TelegramInlineKeyboard | null;
  },
): Promise<string | null> {
  const conversationId = await resolveTelegramConversationId(tx, appointment);
  if (!conversationId) return null;

  if (appointment.conversationId !== conversationId) {
    await tx.appointment.update({
      where: { id: appointment.id },
      data: { conversationId },
    });
  }

  const { message } = await requestTelegramSend({
    tx,
    conversationId,
    body: input.body,
    senderUserId: input.senderUserId,
    clientRequestId: input.clientRequestId,
    replyMarkup: input.replyMarkup,
  });
  return message.id;
}

async function deliverClientNotice(messageId: string | null) {
  if (!messageId) return;
  await tryDeliverTelegramSendNow(messageId).catch((error) => {
    console.warn(
      JSON.stringify({
        level: "warn",
        msg: "telegram.send.appointment_notice_failed",
        messageId,
        error: error instanceof Error ? error.message : String(error),
      }),
    );
  });
}

async function sendProposalMessage(
  tx: DbClient,
  appointment: Appointment,
  opts: {
    kind: "create" | "reschedule" | "alt";
    senderUserId?: string | null;
  },
): Promise<string | null> {
  if (!appointment.confirmationToken) return null;

  const proposedStart = appointment.pendingStartsAt ?? appointment.startsAt;
  const when = formatSlotLabel(proposedStart, appointment.timezone);
  let body: string;
  if (opts.kind === "create") {
    body = `Вам предложена консультация: ${appointment.title}\n${when} (${appointment.timezone})\n\nПодтвердите или выберите другое время.`;
  } else if (opts.kind === "reschedule") {
    const oldWhen = formatSlotLabel(appointment.startsAt, appointment.timezone);
    body = `Предложено новое время консультации «${appointment.title}».\nБыло: ${oldWhen}\nСтанет: ${when}\n\nПодтвердите или выберите другое время.`;
  } else {
    body = `Вы выбрали новое время: ${when} (${appointment.timezone})\nПодтвердите запись.`;
  }

  const messageId = await notifyClientOnTelegram(tx, appointment, {
    body,
    senderUserId: opts.senderUserId,
    clientRequestId: `appt-propose:${appointment.id}:v${appointment.version}:${opts.kind}`,
    replyMarkup: confirmKeyboard(
      appointment.confirmationToken,
      appointment.id,
    ),
  });
  if (!messageId) return null;

  await enqueueClientNudge(tx, appointment.id, 1, appointment.version);
  return messageId;
}

export async function appointmentCreate(
  input: AppointmentCreateInput,
): Promise<{ appointment: Appointment; created: boolean }> {
  const endsAt = input.endsAt ?? endsAtFromStart(input.startsAt);
  assertValidInterval(input.startsAt, endsAt);

  const leadId = input.leadId ?? null;
  const studentId = input.studentId ?? null;
  if ((leadId == null) === (studentId == null)) {
    throw new Error("Exactly one of leadId or studentId is required");
  }

  return prisma.$transaction(async (tx) => {
    const existing = await tx.appointment.findUnique({
      where: { clientRequestId: input.clientRequestId },
    });
    if (existing) {
      return { appointment: existing, created: false };
    }

    await assertNoCuratorConflict(tx, {
      curatorId: input.assignedCuratorId,
      startsAt: input.startsAt,
      endsAt,
    });

    const token = newConfirmationToken();
    const appointment = await tx.appointment.create({
      data: {
        clientRequestId: input.clientRequestId,
        leadId,
        studentId,
        conversationId: input.conversationId ?? null,
        assignedCuratorId: input.assignedCuratorId,
        title: input.title?.trim() || "Консультация",
        startsAt: input.startsAt,
        endsAt,
        timezone: input.timezone ?? APPOINTMENT_TIMEZONE,
        status: APPOINTMENT_STATUS.AWAITING_CLIENT,
        pendingStartsAt: input.startsAt,
        pendingEndsAt: endsAt,
        confirmationToken: token,
        confirmationRequestedAt: new Date(),
        participantsJson: input.participantsJson,
      },
    });

    await sendProposalMessage(tx, appointment, { kind: "create" });

    return { appointment, created: true };
  });
}

/** Propose a reschedule — keeps calendar time until client confirms. */
export async function appointmentProposeReschedule(
  input: AppointmentProposeRescheduleInput,
): Promise<Appointment> {
  const endsAt = input.endsAt ?? endsAtFromStart(input.startsAt);
  assertValidInterval(input.startsAt, endsAt);

  const { appointment, messageId } = await prisma.$transaction(async (tx) => {
    const current = await tx.appointment.findUnique({
      where: { id: input.appointmentId },
    });
    if (!current) throw new Error("Appointment not found");
    if (current.status === APPOINTMENT_STATUS.CANCELLED) {
      throw new Error("Cannot reschedule a cancelled appointment");
    }

    if (current.assignedCuratorId) {
      await assertNoCuratorConflict(tx, {
        curatorId: current.assignedCuratorId,
        startsAt: input.startsAt,
        endsAt,
        excludeId: current.id,
      });
    }

    const token = newConfirmationToken();
    const appointment = await tx.appointment.update({
      where: { id: current.id },
      data: {
        pendingStartsAt: input.startsAt,
        pendingEndsAt: endsAt,
        timezone: input.timezone ?? current.timezone,
        title: input.title?.trim() || current.title,
        confirmationToken: token,
        confirmationRequestedAt: new Date(),
        lastClientNudgeAt: null,
        curatorNudgeSentAt: null,
        version: { increment: 1 },
        // Keep CONFIRMED/PENDING on calendar; UI uses pending* for badge
        status:
          current.status === APPOINTMENT_STATUS.AWAITING_CLIENT
            ? APPOINTMENT_STATUS.AWAITING_CLIENT
            : current.status,
      },
    });

    const messageId = await sendProposalMessage(tx, appointment, {
      kind: "reschedule",
      senderUserId: input.senderUserId,
    });
    return { appointment, messageId };
  });

  await deliverClientNotice(messageId);
  return appointment;
}

/** @deprecated Use appointmentProposeReschedule — kept for tests that expect immediate apply. */
export async function appointmentReschedule(
  input: AppointmentProposeRescheduleInput,
): Promise<Appointment> {
  return appointmentProposeReschedule(input);
}

export async function appointmentConfirmByClient(
  appointmentId: string,
  token: string,
): Promise<{ ok: true; appointment: Appointment } | { ok: false; reason: string }> {
  return prisma.$transaction(async (tx) => {
    const current = await tx.appointment.findUnique({
      where: { id: appointmentId },
    });
    if (!current) return { ok: false as const, reason: "not_found" };
    if (current.confirmationToken !== token) {
      return { ok: false as const, reason: "bad_token" };
    }
    if (current.status === APPOINTMENT_STATUS.CANCELLED) {
      return { ok: false as const, reason: "cancelled" };
    }

    const startsAt = current.pendingStartsAt ?? current.startsAt;
    const endsAt = current.pendingEndsAt ?? current.endsAt;

    if (current.assignedCuratorId) {
      await assertNoCuratorConflict(tx, {
        curatorId: current.assignedCuratorId,
        startsAt,
        endsAt,
        excludeId: current.id,
      });
    }

    const appointment = await tx.appointment.update({
      where: { id: current.id },
      data: {
        startsAt,
        endsAt,
        pendingStartsAt: null,
        pendingEndsAt: null,
        confirmationToken: null,
        confirmationRequestedAt: null,
        lastClientNudgeAt: null,
        curatorNudgeSentAt: null,
        status: APPOINTMENT_STATUS.PENDING,
        version: { increment: 1 },
      },
    });

    await enqueueOutbox(tx, {
      aggregateType: "Appointment",
      aggregateId: appointment.id,
      eventType: "calendar.upsert",
      payload: { appointmentId: appointment.id },
      idempotencyKey: `calendar.upsert:${appointment.id}:v${appointment.version}`,
    });

    return { ok: true as const, appointment };
  });
}

/** Admin override when there is no Telegram conversation. */
export async function appointmentConfirmManual(
  appointmentId: string,
): Promise<Appointment> {
  const current = await prisma.appointment.findUnique({
    where: { id: appointmentId },
  });
  if (!current) throw new Error("Appointment not found");

  let token = current.confirmationToken;
  if (!token) {
    token = newConfirmationToken();
    await prisma.appointment.update({
      where: { id: appointmentId },
      data: {
        confirmationToken: token,
        pendingStartsAt: current.pendingStartsAt ?? current.startsAt,
        pendingEndsAt: current.pendingEndsAt ?? current.endsAt,
      },
    });
  }

  const result = await appointmentConfirmByClient(appointmentId, token);
  if (!result.ok) throw new Error(`Cannot confirm: ${result.reason}`);
  return result.appointment;
}

export async function appointmentOfferAltSlots(
  appointmentId: string,
  token: string,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const current = await prisma.appointment.findUnique({
    where: { id: appointmentId },
  });
  if (!current) return { ok: false, reason: "not_found" };
  if (current.confirmationToken !== token) {
    return { ok: false, reason: "bad_token" };
  }
  if (!current.conversationId || !current.assignedCuratorId) {
    return { ok: false, reason: "no_conversation" };
  }

  const from = new Date();
  const to = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000);
  const slots = await listOpenSlots({
    curatorId: current.assignedCuratorId,
    from,
    to,
    excludeAppointmentId: current.id,
    timeZone: current.timezone,
  });

  if (slots.length === 0) {
    await requestTelegramSend({
      conversationId: current.conversationId,
      body: "Свободных слотов на ближайшие 2 недели нет. Куратор свяжется с вами.",
      clientRequestId: `appt-alt-empty:${current.id}:v${current.version}`,
    });
    return { ok: true };
  }

  await requestTelegramSend({
    conversationId: current.conversationId,
    body: "Выберите удобное время:",
    clientRequestId: `appt-alt-list:${current.id}:v${current.version}:${Date.now()}`,
    replyMarkup: altSlotsKeyboard(token, current.id, slots),
  });

  return { ok: true };
}

export async function appointmentSelectAltSlot(
  appointmentId: string,
  token: string,
  slotKey: string,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const slot = parseSlotKey(slotKey);
  if (!slot) return { ok: false, reason: "bad_slot" };

  return prisma.$transaction(async (tx) => {
    const current = await tx.appointment.findUnique({
      where: { id: appointmentId },
    });
    if (!current) return { ok: false as const, reason: "not_found" };
    if (current.confirmationToken !== token) {
      return { ok: false as const, reason: "bad_token" };
    }
    if (!current.assignedCuratorId) {
      return { ok: false as const, reason: "no_curator" };
    }

    await assertNoCuratorConflict(tx, {
      curatorId: current.assignedCuratorId,
      startsAt: slot.startsAt,
      endsAt: slot.endsAt,
      excludeId: current.id,
    });

    const newToken = newConfirmationToken();
    const appointment = await tx.appointment.update({
      where: { id: current.id },
      data: {
        pendingStartsAt: slot.startsAt,
        pendingEndsAt: slot.endsAt,
        confirmationToken: newToken,
        confirmationRequestedAt: new Date(),
        lastClientNudgeAt: null,
        curatorNudgeSentAt: null,
        version: { increment: 1 },
        status:
          current.googleEventId == null
            ? APPOINTMENT_STATUS.AWAITING_CLIENT
            : current.status,
      },
    });

    await sendProposalMessage(tx, appointment, { kind: "alt" });
    return { ok: true as const };
  });
}

export async function appointmentCancel(
  appointmentId: string,
  options?: { senderUserId?: string | null },
): Promise<Appointment> {
  const { appointment, messageId } = await prisma.$transaction(async (tx) => {
    const current = await tx.appointment.findUnique({
      where: { id: appointmentId },
    });
    if (!current) {
      throw new Error("Appointment not found");
    }
    if (current.status === APPOINTMENT_STATUS.CANCELLED) {
      return { appointment: current, messageId: null as string | null };
    }

    const whenLabel = formatSlotLabel(
      current.pendingStartsAt ?? current.startsAt,
      current.timezone,
    );
    const appointment = await tx.appointment.update({
      where: { id: current.id },
      data: {
        status: APPOINTMENT_STATUS.CANCELLED,
        pendingStartsAt: null,
        pendingEndsAt: null,
        confirmationToken: null,
        version: { increment: 1 },
      },
    });

    if (appointment.googleEventId || current.googleEventId) {
      await enqueueOutbox(tx, {
        aggregateType: "Appointment",
        aggregateId: appointment.id,
        eventType: "calendar.delete",
        payload: {
          appointmentId: appointment.id,
          googleEventId: appointment.googleEventId ?? current.googleEventId,
        },
        idempotencyKey: `calendar.delete:${appointment.id}:v${appointment.version}`,
      });
    }

    const messageId = await notifyClientOnTelegram(tx, appointment, {
      body: formatAppointmentCancelNotice({
        title: appointment.title,
        whenLabel,
        timezone: appointment.timezone,
      }),
      senderUserId: options?.senderUserId,
      clientRequestId: `appt-cancel:${appointment.id}:v${appointment.version}`,
    });

    return { appointment, messageId };
  });

  await deliverClientNotice(messageId);
  return appointment;
}
