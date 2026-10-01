import { randomUUID } from "crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { sendBookingLinkForConversation } from "@/server/booking/send-link";
import { appointmentBookByGuest } from "@/server/commands/appointments";
import { resolveConsultationEmail } from "@/server/registration/contact";
import { listOpenSlots } from "@/server/services/appointments/slots";

const hasDatabase = Boolean(process.env.DATABASE_URL?.trim());
const describeDb = hasDatabase ? describe : describe.skip;

describeDb("client books a consultation from the site", () => {
  const prisma = new PrismaClient();
  const prefix = `book-flow-${randomUUID()}`;
  const email = `${prefix}@student.test`;
  let curatorId = "";
  let leadId = "";
  let conversationId = "";
  const userIds: string[] = [];

  beforeAll(async () => {
    const curator = await prisma.user.create({
      data: {
        email: `${prefix}@curator.test`,
        name: "Test Curator",
        passwordHash: "not-used",
        role: "CURATOR",
      },
    });
    curatorId = curator.id;
    userIds.push(curator.id);
    const lead = await prisma.lead.create({
      data: {
        firstName: "Аня",
        lastName: "Тест",
        source: "TELEGRAM",
        status: "NEW",
        assignedCuratorId: curator.id,
      },
    });
    leadId = lead.id;
    const conversation = await prisma.conversation.create({
      data: {
        channel: "TELEGRAM",
        leadId: lead.id,
        assignedCuratorId: curator.id,
      },
    });
    conversationId = conversation.id;
    await prisma.channelIdentity.create({
      data: {
        channel: "TELEGRAM",
        externalId: prefix,
        leadId: lead.id,
      },
    });
  });

  afterAll(async () => {
    const appointments = await prisma.appointment.findMany({
      where: { leadId },
      select: { id: true },
    });
    const messages = await prisma.conversationMessage.findMany({
      where: { conversationId },
      select: { id: true },
    });
    await prisma.deliveryAttempt.deleteMany({
      where: { messageId: { in: messages.map((message) => message.id) } },
    });
    await prisma.outboxEvent.deleteMany({
      where: {
        OR: [
          { aggregateId: { in: appointments.map((row) => row.id) } },
          { aggregateId: { in: messages.map((row) => row.id) } },
          { idempotencyKey: { contains: prefix } },
        ],
      },
    });
    await prisma.bookingInvite.deleteMany({ where: { conversationId } });
    await prisma.inAppNotification.deleteMany({
      where: { userId: curatorId },
    });
    await prisma.appointment.deleteMany({
      where: { id: { in: appointments.map((row) => row.id) } },
    });
    await prisma.conversationMessage.deleteMany({ where: { conversationId } });
    if (conversationId) {
      await prisma.conversation.delete({ where: { id: conversationId } }).catch(() => undefined);
    }
    await prisma.channelIdentity.deleteMany({ where: { externalId: prefix } });
    if (leadId) {
      await prisma.lead.update({
        where: { id: leadId },
        data: { convertedStudentId: null },
      }).catch(() => undefined);
      await prisma.lead.delete({ where: { id: leadId } }).catch(() => undefined);
    }
    if (userIds.length > 0) {
      await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    }
    await prisma.$disconnect();
  });

  it("sends a site link and books a slot without opening a cabinet", async () => {
    const sent = await sendBookingLinkForConversation({
      conversationId,
      env: { AUTH_URL: "https://admission-os-production.up.railway.app" },
    });
    expect(sent).toBe("sent");

    const invite = await prisma.bookingInvite.findFirst({
      where: { conversationId, appointmentId: null },
    });
    expect(invite?.curatorId).toBe(curatorId);
    expect(invite?.token).toBeTruthy();

    const message = await prisma.conversationMessage.findFirst({
      where: { conversationId, direction: "OUTBOUND" },
      orderBy: { createdAt: "desc" },
    });
    expect(message?.body).toContain(`/book/${invite?.token}`);
    expect(message?.body).toContain("admission-os-production.up.railway.app");
    expect(message?.body).toContain("на почту, которую укажете в форме");

    const again = await sendBookingLinkForConversation({
      conversationId,
      env: { AUTH_URL: "https://admission-os-production.up.railway.app" },
    });
    expect(again).toBe("already_sent");

    const slots = await listOpenSlots({
      curatorId,
      from: new Date(),
      to: new Date(Date.now() + 21 * 24 * 60 * 60 * 1000),
    });
    expect(slots.length).toBeGreaterThan(0);

    const appointment = await appointmentBookByGuest({
      token: invite!.token,
      guestName: "Аня Тест",
      guestEmail: email,
      startsAt: slots[0].startsAt,
    });
    expect(appointment.status).toBe("PENDING");
    expect(appointment.assignedCuratorId).toBe(curatorId);
    expect(appointment.title).toBe("Консультация: Аня Тест");
    expect(appointment.studentId).toBeNull();
    expect(appointment.leadId).toBe(leadId);
    expect(appointment.guestEmail).toBe(email);
    expect(appointment.confirmationToken).toBeNull();

    const student = await prisma.student.findUnique({ where: { email } });
    expect(student).toBeNull();

    const lead = await prisma.lead.findUnique({ where: { id: leadId } });
    expect(lead?.convertedStudentId).toBeNull();
    expect(lead?.email).toBe(email);
    expect(await resolveConsultationEmail(leadId)).toBe(email);

    const scheduling = await prisma.outboxEvent.findFirst({
      where: { aggregateId: appointment.id, eventType: "scheduling.requested" },
    });
    expect(scheduling).toBeTruthy();
    const calendar = await prisma.outboxEvent.findFirst({
      where: { aggregateId: appointment.id, eventType: "calendar.upsert" },
    });
    expect(calendar).toBeNull();

    const notice = await prisma.conversationMessage.findFirst({
      where: { conversationId, body: { contains: "Консультация назначена" } },
    });
    expect(notice?.body).toContain("Консультация назначена");
    expect(notice?.body).toContain(email);
    expect(notice?.body).toContain("пришлём в этот чат и на почту");

    const notification = await prisma.inAppNotification.findFirst({
      where: { userId: curatorId, type: "appointment.booked" },
    });
    expect(notification?.studentId ?? null).toBeNull();
    expect(notification?.body).toContain(email);

    const consumed = await prisma.bookingInvite.findUnique({ where: { id: invite!.id } });
    expect(consumed?.appointmentId).toBe(appointment.id);

    const reschedule = await sendBookingLinkForConversation({
      conversationId,
      env: { AUTH_URL: "https://admission-os-production.up.railway.app" },
    });
    expect(reschedule.startsWith("already_booked:")).toBe(true);

    const rescheduleInvite = await prisma.bookingInvite.findFirst({
      where: { conversationId, appointmentId: null },
      orderBy: { createdAt: "desc" },
    });
    expect(rescheduleInvite?.token).toBeTruthy();
    expect(rescheduleInvite?.id).not.toBe(invite!.id);

    const rescheduleMessage = await prisma.conversationMessage.findFirst({
      where: { conversationId, body: { contains: "Чтобы поменять время" } },
      orderBy: { createdAt: "desc" },
    });
    expect(rescheduleMessage?.body).toContain(`/book/${rescheduleInvite?.token}`);
    expect(rescheduleMessage?.body).toContain("Консультация сейчас:");

    const laterSlots = await listOpenSlots({
      curatorId,
      from: new Date(),
      to: new Date(Date.now() + 31 * 24 * 60 * 60 * 1000),
      excludeAppointmentId: appointment.id,
    });
    expect(laterSlots.length).toBeGreaterThan(1);
    const newSlot = laterSlots.find((slot) => slot.startsAt.getTime() !== appointment.startsAt.getTime());
    expect(newSlot).toBeTruthy();

    const moved = await appointmentBookByGuest({
      token: rescheduleInvite!.token,
      guestName: "Аня Тест",
      guestEmail: email,
      startsAt: newSlot!.startsAt,
    });
    expect(moved.id).not.toBe(appointment.id);
    expect(moved.status).toBe("PENDING");

    const old = await prisma.appointment.findUnique({ where: { id: appointment.id } });
    expect(old?.status).toBe("CANCELLED");
  }, 30000);

  it("sends the booking link without a curator and does not pause the chat", async () => {
    const bareLead = await prisma.lead.create({
      data: {
        firstName: "Боря",
        lastName: "Тест",
        source: "TELEGRAM",
        status: "NEW",
      },
    });
    const bareConversation = await prisma.conversation.create({
      data: {
        channel: "TELEGRAM",
        leadId: bareLead.id,
      },
    });
    await prisma.channelIdentity.create({
      data: {
        channel: "TELEGRAM",
        externalId: `${prefix}-bare`,
        leadId: bareLead.id,
      },
    });

    try {
      const sent = await sendBookingLinkForConversation({
        conversationId: bareConversation.id,
        env: { AUTH_URL: "https://admission-os-production.up.railway.app" },
      });
      expect(sent).toBe("sent");

      const invite = await prisma.bookingInvite.findFirst({
        where: { conversationId: bareConversation.id, appointmentId: null },
      });
      expect(invite?.curatorId).toBeNull();

      const conversation = await prisma.conversation.findUnique({
        where: { id: bareConversation.id },
        select: { automationPausedAt: true, automationPauseReason: true },
      });
      expect(conversation?.automationPausedAt).toBeNull();
      expect(conversation?.automationPauseReason).toBeNull();

      const slots = await listOpenSlots({
        curatorId: null,
        from: new Date(),
        to: new Date(Date.now() + 21 * 24 * 60 * 60 * 1000),
      });
      expect(slots.length).toBeGreaterThan(0);

      const guestEmail = `${prefix}-bare@student.test`;
      const appointment = await appointmentBookByGuest({
        token: invite!.token,
        guestName: "Боря Тест",
        guestEmail,
        startsAt: slots[0].startsAt,
      });
      expect(appointment.assignedCuratorId).toBeNull();
      expect(appointment.title).toBe("Консультация: Боря Тест");
      expect(appointment.guestEmail).toBe(guestEmail);

      const admin = await prisma.user.findFirst({
        where: { role: "ADMIN" },
        select: { id: true },
      });
      if (admin) {
        const notification = await prisma.inAppNotification.findFirst({
          where: {
            userId: admin.id,
            type: "appointment.booked",
            body: { contains: guestEmail },
          },
          orderBy: { createdAt: "desc" },
        });
        expect(notification?.body).toContain(guestEmail);
        expect(notification?.body).toContain("Боря Тест");
      }
    } finally {
      const appointments = await prisma.appointment.findMany({
        where: { leadId: bareLead.id },
        select: { id: true },
      });
      const messages = await prisma.conversationMessage.findMany({
        where: { conversationId: bareConversation.id },
        select: { id: true },
      });
      await prisma.deliveryAttempt.deleteMany({
        where: { messageId: { in: messages.map((message) => message.id) } },
      });
      await prisma.outboxEvent.deleteMany({
        where: {
          OR: [
            { aggregateId: { in: appointments.map((row) => row.id) } },
            { aggregateId: { in: messages.map((row) => row.id) } },
          ],
        },
      });
      await prisma.bookingInvite.deleteMany({ where: { conversationId: bareConversation.id } });
      await prisma.inAppNotification.deleteMany({
        where: {
          metadataJson: { contains: bareConversation.id },
        },
      });
      await prisma.appointment.deleteMany({
        where: { id: { in: appointments.map((row) => row.id) } },
      });
      await prisma.conversationMessage.deleteMany({
        where: { conversationId: bareConversation.id },
      });
      await prisma.conversation.delete({ where: { id: bareConversation.id } }).catch(() => undefined);
      await prisma.channelIdentity.deleteMany({ where: { externalId: `${prefix}-bare` } });
      await prisma.lead.delete({ where: { id: bareLead.id } }).catch(() => undefined);
    }
  }, 30000);
});
