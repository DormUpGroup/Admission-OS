import type { Appointment, Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { enqueueOutbox, type DbClient } from "@/server/commands/outbox";

export type AppointmentCreateInput = {
  clientRequestId: string;
  leadId?: string | null;
  studentId?: string | null;
  conversationId?: string | null;
  assignedCuratorId: string;
  title?: string;
  startsAt: Date;
  endsAt: Date;
  timezone?: string;
  participantsJson?: Prisma.InputJsonValue;
};

export type AppointmentRescheduleInput = {
  appointmentId: string;
  startsAt: Date;
  endsAt: Date;
  timezone?: string;
  title?: string;
};

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
      status: { in: ["PENDING", "CONFIRMED"] },
      startsAt: { lt: input.endsAt },
      endsAt: { gt: input.startsAt },
      ...(input.excludeId ? { id: { not: input.excludeId } } : {}),
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

export async function appointmentCreate(
  input: AppointmentCreateInput,
): Promise<{ appointment: Appointment; created: boolean }> {
  assertValidInterval(input.startsAt, input.endsAt);

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
      endsAt: input.endsAt,
    });

    const appointment = await tx.appointment.create({
      data: {
        clientRequestId: input.clientRequestId,
        leadId,
        studentId,
        conversationId: input.conversationId ?? null,
        assignedCuratorId: input.assignedCuratorId,
        title: input.title?.trim() || "Консультация",
        startsAt: input.startsAt,
        endsAt: input.endsAt,
        timezone: input.timezone ?? "Europe/Rome",
        status: "PENDING",
        participantsJson: input.participantsJson,
      },
    });

    await enqueueOutbox(tx, {
      aggregateType: "Appointment",
      aggregateId: appointment.id,
      eventType: "calendar.upsert",
      payload: { appointmentId: appointment.id },
      idempotencyKey: `calendar.upsert:${appointment.id}:v${appointment.version}`,
    });

    return { appointment, created: true };
  });
}

export async function appointmentReschedule(
  input: AppointmentRescheduleInput,
): Promise<Appointment> {
  assertValidInterval(input.startsAt, input.endsAt);

  return prisma.$transaction(async (tx) => {
    const current = await tx.appointment.findUnique({
      where: { id: input.appointmentId },
    });
    if (!current) {
      throw new Error("Appointment not found");
    }
    if (current.status === "CANCELLED") {
      throw new Error("Cannot reschedule a cancelled appointment");
    }

    if (current.assignedCuratorId) {
      await assertNoCuratorConflict(tx, {
        curatorId: current.assignedCuratorId,
        startsAt: input.startsAt,
        endsAt: input.endsAt,
        excludeId: current.id,
      });
    }

    const appointment = await tx.appointment.update({
      where: { id: current.id },
      data: {
        startsAt: input.startsAt,
        endsAt: input.endsAt,
        timezone: input.timezone ?? current.timezone,
        title: input.title?.trim() || current.title,
        status: current.status === "CONFIRMED" ? "PENDING" : current.status,
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

    return appointment;
  });
}

export async function appointmentCancel(
  appointmentId: string,
): Promise<Appointment> {
  return prisma.$transaction(async (tx) => {
    const current = await tx.appointment.findUnique({
      where: { id: appointmentId },
    });
    if (!current) {
      throw new Error("Appointment not found");
    }
    if (current.status === "CANCELLED") {
      return current;
    }

    const appointment = await tx.appointment.update({
      where: { id: appointmentId },
      data: {
        status: "CANCELLED",
        version: { increment: 1 },
      },
    });

    await enqueueOutbox(tx, {
      aggregateType: "Appointment",
      aggregateId: appointment.id,
      eventType: "calendar.delete",
      payload: {
        appointmentId: appointment.id,
        googleEventId: appointment.googleEventId,
      },
      idempotencyKey: `calendar.delete:${appointment.id}:v${appointment.version}`,
    });

    return appointment;
  });
}
