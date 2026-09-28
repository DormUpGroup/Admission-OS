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
  let studentId = "";
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
      where: { OR: [{ leadId }, { studentId: studentId || "__none__" }] },
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
      where: { OR: [{ userId: curatorId }, { studentId: studentId || "__none__" }] },
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
    if (studentId) {
      await prisma.student.delete({ where: { id: studentId } }).catch(() => undefined);
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

    const calendar = await prisma.outboxEvent.findFirst({
      where: { aggregateId: appointment.id, eventType: "calendar.upsert" },
    });
    expect(calendar).toBeTruthy();

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
  }, 30000);
});
