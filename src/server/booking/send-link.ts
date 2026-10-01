import { randomBytes } from "crypto";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { sendAgentClientMessage } from "@/server/automation/actions";
import { APPOINTMENT_STATUS } from "@/server/commands/appointments";
import {
  APPOINTMENT_TIMEZONE,
  formatSlotLabel,
} from "@/server/services/appointments/slots";
import {
  BOOKING_INVITE_TTL_MS,
  bookingInviteMessage,
  bookingPageUrl,
  pickBookingCuratorId,
} from "./link";

const ACTIVE = [
  APPOINTMENT_STATUS.AWAITING_CLIENT,
  APPOINTMENT_STATUS.PENDING,
  APPOINTMENT_STATUS.CONFIRMED,
];

export type SendBookingLinkResult =
  | "sent"
  | "already_sent"
  | `already_booked:${string}`
  | `booking_unavailable:${string}`;

function isUniqueConstraint(error: unknown): boolean {
  return Boolean(
    error &&
      typeof error === "object" &&
      "code" in error &&
      (error as { code?: string }).code === "P2002",
  );
}

function newToken() {
  return randomBytes(24).toString("base64url");
}

type ConversationForBooking = Prisma.ConversationGetPayload<{
  include: {
    lead: { select: { id: true; assignedCuratorId: true } };
    student: { select: { id: true; curatorId: true } };
  };
}>;

async function upcomingAppointment(
  conversation: ConversationForBooking,
  now: Date,
) {
  const or: Prisma.AppointmentWhereInput[] = [{ conversationId: conversation.id }];
  if (conversation.leadId) or.push({ leadId: conversation.leadId });
  if (conversation.studentId) or.push({ studentId: conversation.studentId });
  return prisma.appointment.findFirst({
    where: {
      status: { in: [...ACTIVE] },
      endsAt: { gt: now },
      OR: or,
    },
    orderBy: { startsAt: "asc" },
  });
}

function inviteExpiry(now: Date) {
  return new Date(now.getTime() + BOOKING_INVITE_TTL_MS);
}

async function ensureOpenInvite(input: {
  conversation: ConversationForBooking;
  curatorId: string | null;
  now: Date;
}) {
  const open = await prisma.bookingInvite.findFirst({
    where: { conversationId: input.conversation.id, appointmentId: null },
    orderBy: { createdAt: "desc" },
  });
  if (open && open.expiresAt > input.now) return open;
  if (open) {
    return prisma.bookingInvite.update({
      where: { id: open.id },
      data: {
        token: newToken(),
        curatorId: input.curatorId,
        leadId: input.conversation.leadId,
        studentId: input.conversation.studentId,
        expiresAt: inviteExpiry(input.now),
      },
    });
  }

  try {
    return await prisma.bookingInvite.create({
      data: {
        token: newToken(),
        conversationId: input.conversation.id,
        leadId: input.conversation.leadId,
        studentId: input.conversation.studentId,
        curatorId: input.curatorId,
        expiresAt: inviteExpiry(input.now),
      },
    });
  } catch (error) {
    if (!isUniqueConstraint(error)) throw error;
    const raced = await prisma.bookingInvite.findFirst({
      where: { conversationId: input.conversation.id, appointmentId: null },
      orderBy: { createdAt: "desc" },
    });
    if (!raced) throw error;
    if (raced.expiresAt > input.now) return raced;
    return prisma.bookingInvite.update({
      where: { id: raced.id },
      data: {
        token: newToken(),
        expiresAt: inviteExpiry(input.now),
        curatorId: input.curatorId,
      },
    });
  }
}

/**
 * Hermes calls this instead of offering times in chat. The message text and
 * URL are built here so the model cannot invent a link. A curator is not
 * required: the shared Google Calendar owns the slot.
 */
export async function sendBookingLinkForConversation(input: {
  agentRunId?: string | null;
  conversationId: string;
  now?: Date;
  env?: Record<string, string | undefined>;
}): Promise<SendBookingLinkResult> {
  const now = input.now ?? new Date();
  const conversation = await prisma.conversation.findUnique({
    where: { id: input.conversationId },
    include: {
      lead: { select: { id: true, assignedCuratorId: true } },
      student: { select: { id: true, curatorId: true } },
    },
  });
  if (!conversation) return "booking_unavailable:conversation_not_found";

  const booked = await upcomingAppointment(conversation, now);
  if (booked) {
    const when = formatSlotLabel(
      booked.pendingStartsAt ?? booked.startsAt,
      booked.timezone || APPOINTMENT_TIMEZONE,
    );
    const sent = await sendAgentClientMessage({
      agentRunId: input.agentRunId,
      conversationId: conversation.id,
      body: `Консультация уже назначена.\n${when} (${booked.timezone || APPOINTMENT_TIMEZONE})`,
      clientRequestId: `booking-already:${booked.id}`,
    });
    if (sent.status === "ALLOWED" && sent.result.duplicate) return "already_sent";
    if (sent.status !== "ALLOWED") {
      return `booking_unavailable:${sent.policy.reasons.join(",") || sent.status}`;
    }
    return `already_booked:${when}`;
  }

  const curatorId = pickBookingCuratorId([
    conversation.assignedCuratorId,
    conversation.lead?.assignedCuratorId,
    conversation.student?.curatorId,
  ]);

  let invite: Awaited<ReturnType<typeof ensureOpenInvite>>;
  let url: string;
  try {
    invite = await ensureOpenInvite({ conversation, curatorId, now });
    url = bookingPageUrl(invite.token, input.env);
  } catch (error) {
    const reason = error instanceof Error ? error.message : "invite_failed";
    return `booking_unavailable:${reason}`;
  }

  const sent = await sendAgentClientMessage({
    agentRunId: input.agentRunId,
    conversationId: conversation.id,
    body: bookingInviteMessage(url),
    clientRequestId: `booking-link:${invite.id}:${invite.expiresAt.toISOString()}`,
  });
  if (sent.status === "ALLOWED" && sent.result.duplicate) return "already_sent";
  if (sent.status !== "ALLOWED") {
    return `booking_unavailable:${sent.policy.reasons.join(",") || sent.status}`;
  }
  return "sent";
}
