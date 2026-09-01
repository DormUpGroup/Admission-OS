import { AccompanimentStatus } from "@/lib/enums";
import { prisma } from "@/lib/db";
import type { Prisma } from "@prisma/client";
import { logActivity } from "@/server/services/activity";
import {
  canAcceptAccompaniment,
  canAcceptToCohort,
  canChangeIntakeLimit,
  canRejectAccompaniment,
  intakeAliases,
  normalizeIntakeKey,
} from "./rules";

export class AccompanimentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AccompanimentError";
  }
}

export function accompanimentAcceptedActivity(input: {
  studentId: string;
  userId: string;
  intake: string;
}) {
  return {
    type: "ACCOMPANIMENT_ACCEPTED" as const,
    studentId: input.studentId,
    userId: input.userId,
    metadata: JSON.stringify({
      intake: input.intake,
      note: "Принят на сопровождение",
    }),
  };
}

async function lockCohort(tx: Prisma.TransactionClient, intake: string) {
  const key = normalizeIntakeKey(intake);
  const existing = await tx.intakeCohort.findUnique({ where: { intake: key } });
  if (existing) {
    await tx.intakeCohort.update({
      where: { id: existing.id },
      data: { updatedAt: new Date() },
    });
    return existing;
  }
  return tx.intakeCohort.create({
    data: { intake: key, seatLimit: null, isActive: false },
  });
}

export async function acceptStudentToAccompaniment(input: {
  studentId: string;
  userId: string;
  role: string;
}) {
  if (!canAcceptAccompaniment(input.role)) {
    throw new AccompanimentError("Недостаточно прав для принятия на сопровождение");
  }

  return prisma.$transaction(async (tx) => {
    const student = await tx.student.findUnique({
      where: { id: input.studentId },
    });
    if (!student) throw new AccompanimentError("Ученик не найден");
    if (student.status === "ARCHIVED") {
      throw new AccompanimentError("Нельзя принять ученика из архива");
    }
    if (student.accompanimentStatus === AccompanimentStatus.ACCEPTED) {
      return { ok: true as const, alreadyAccepted: true };
    }

    const cohort = await lockCohort(tx, student.intake);
    const occupied = await tx.student.count({
      where: {
        accompanimentStatus: AccompanimentStatus.ACCEPTED,
        intake: { in: intakeAliases(student.intake) },
      },
    });
    const decision = canAcceptToCohort(occupied, cohort.seatLimit);
    if (!decision.ok) {
      throw new AccompanimentError(decision.reason ?? "Мест в наборе нет");
    }

    await tx.student.update({
      where: { id: student.id },
      data: {
        accompanimentStatus: AccompanimentStatus.ACCEPTED,
        acceptedAt: new Date(),
        acceptedById: input.userId,
        curatorId: student.curatorId ?? input.userId,
      },
    });

    await tx.activity.create({
      data: accompanimentAcceptedActivity({
        studentId: student.id,
        userId: input.userId,
        intake: student.intake,
      }),
    });

    const occupiedAfter = await tx.student.count({
      where: {
        accompanimentStatus: AccompanimentStatus.ACCEPTED,
        intake: { in: intakeAliases(student.intake) },
      },
    });
    if (cohort.seatLimit != null && occupiedAfter > cohort.seatLimit) {
      throw new AccompanimentError("Мест в наборе нет");
    }

    return { ok: true as const, alreadyAccepted: false };
  });
}

export async function requestAccompanimentClarification(input: {
  studentId: string;
  userId: string;
  note?: string;
}) {
  const student = await prisma.student.findUnique({
    where: { id: input.studentId },
  });
  if (!student) throw new AccompanimentError("Ученик не найден");
  if (student.accompanimentStatus === AccompanimentStatus.ACCEPTED) {
    throw new AccompanimentError("Ученик уже принят на сопровождение");
  }

  await prisma.student.update({
    where: { id: student.id },
    data: { accompanimentStatus: AccompanimentStatus.UNDER_REVIEW },
  });
  await logActivity({
    type: "ACCOMPANIMENT_CLARIFICATION_REQUESTED",
    studentId: student.id,
    userId: input.userId,
    metadata: { note: input.note || "Запрошено уточнение по анкете" },
  });
}

export async function rejectAccompaniment(input: {
  studentId: string;
  userId: string;
  role: string;
  note?: string;
}) {
  if (!canRejectAccompaniment(input.role)) {
    throw new AccompanimentError("Отказать может только администратор");
  }
  const student = await prisma.student.findUnique({
    where: { id: input.studentId },
  });
  if (!student) throw new AccompanimentError("Ученик не найден");

  await prisma.student.update({
    where: { id: student.id },
    data: {
      accompanimentStatus: AccompanimentStatus.REJECTED,
      acceptedAt: null,
      acceptedById: null,
    },
  });
  await logActivity({
    type: "ACCOMPANIMENT_REJECTED",
    studentId: student.id,
    userId: input.userId,
    metadata: { note: input.note || "Не принят на сопровождение" },
  });
}

export async function updateIntakeSeatLimit(input: {
  intake: string;
  seatLimit: number | null;
  isActive?: boolean;
  userId: string;
  role: string;
}) {
  if (!canChangeIntakeLimit(input.role)) {
    throw new AccompanimentError("Лимит набора может менять только администратор");
  }
  const key = normalizeIntakeKey(input.intake);
  if (!key) throw new AccompanimentError("Не указан набор");
  if (input.seatLimit != null && (input.seatLimit < 0 || !Number.isFinite(input.seatLimit))) {
    throw new AccompanimentError("Лимит должен быть неотрицательным числом");
  }

  const existing = await prisma.intakeCohort.findUnique({ where: { intake: key } });
  if (input.isActive) {
    await prisma.intakeCohort.updateMany({ data: { isActive: false } });
  }
  const cohort = existing
    ? await prisma.intakeCohort.update({
        where: { id: existing.id },
        data: {
          seatLimit: input.seatLimit,
          isActive: input.isActive ?? existing.isActive,
        },
      })
    : await prisma.intakeCohort.create({
        data: {
          intake: key,
          seatLimit: input.seatLimit,
          isActive: input.isActive ?? false,
        },
      });

  return cohort;
}

export async function markQuestionnairePending(studentId: string) {
  const student = await prisma.student.findUnique({
    where: { id: studentId },
    select: { accompanimentStatus: true },
  });
  if (!student) return;
  if (
    student.accompanimentStatus === AccompanimentStatus.NONE
  ) {
    await prisma.student.update({
      where: { id: studentId },
      data: { accompanimentStatus: AccompanimentStatus.PENDING },
    });
  }
}
