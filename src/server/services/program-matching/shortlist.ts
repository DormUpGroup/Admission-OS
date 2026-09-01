import { prisma } from "@/lib/db";

export async function updateMatchCuratorStatus(input: {
  matchId: string;
  status: "APPROVED" | "REJECTED" | "NEEDS_REVIEW" | "SHORTLISTED";
  userId: string;
  notes?: string | null;
}) {
  const match = await prisma.programMatch.update({
    where: { id: input.matchId },
    data: {
      curatorStatus: input.status,
      curatorNotes: input.notes ?? undefined,
      reviewedById: input.userId,
      reviewedAt: new Date(),
    },
  });

  await prisma.activity.create({
    data: {
      type: "PROGRAM_MATCH_REVIEWED",
      studentId: match.studentId,
      userId: input.userId,
      metadata: JSON.stringify({
        matchId: match.id,
        status: input.status,
      }),
    },
  });

  return match;
}

export async function addToShortlist(input: {
  studentId: string;
  programAcademicYearId: string;
  matchId?: string | null;
  curatorNote?: string | null;
  userId: string;
}) {
  if (input.matchId) {
    await prisma.programMatch.update({
      where: { id: input.matchId },
      data: {
        curatorStatus: "SHORTLISTED",
        reviewedById: input.userId,
        reviewedAt: new Date(),
      },
    });
  }

  const item = await prisma.studentShortlistItem.upsert({
    where: {
      studentId_programAcademicYearId: {
        studentId: input.studentId,
        programAcademicYearId: input.programAcademicYearId,
      },
    },
    create: {
      studentId: input.studentId,
      programAcademicYearId: input.programAcademicYearId,
      programMatchId: input.matchId ?? null,
      curatorNote: input.curatorNote ?? null,
      visibleToStudent: true,
      studentStatus: "PENDING",
    },
    update: {
      programMatchId: input.matchId ?? undefined,
      curatorNote: input.curatorNote ?? undefined,
      visibleToStudent: true,
    },
  });

  await prisma.activity.create({
    data: {
      type: "PROGRAM_SHORTLISTED",
      studentId: input.studentId,
      userId: input.userId,
      metadata: JSON.stringify({
        programAcademicYearId: input.programAcademicYearId,
      }),
    },
  });

  return item;
}

export async function listStudentShortlist(studentId: string) {
  return prisma.studentShortlistItem.findMany({
    where: { studentId, visibleToStudent: true },
    include: {
      programAcademicYear: {
        include: {
          program: { include: { university: true } },
          cycles: true,
          tuition: true,
          requirements: true,
        },
      },
    },
    orderBy: { createdAt: "desc" },
  });
}

export async function evaluateManualProgram(input: {
  studentId: string;
  programId: string;
  userId: string;
}) {
  const { generateProgramMatches } = await import("./program-matching");
  const { MATCHING_ENGINE_VERSION } = await import(
    "@/lib/program-matching/config"
  );

  const pays = await prisma.programAcademicYear.findMany({
    where: { programId: input.programId },
    select: { id: true },
  });
  if (pays.length === 0) return null;

  const scored = await generateProgramMatches(input.studentId, {
    includeNotEligible: true,
    limit: 50,
    programAcademicYearIds: pays.map((p) => p.id),
    includeShortlisted: false,
  });
  const evaluated = scored.find((m) => m.programId === input.programId);
  if (!evaluated) return null;

  await prisma.programMatch.upsert({
    where: {
      studentId_programAcademicYearId: {
        studentId: input.studentId,
        programAcademicYearId: evaluated.programAcademicYearId,
      },
    },
    create: {
      studentId: input.studentId,
      programAcademicYearId: evaluated.programAcademicYearId,
      eligibilityStatus: evaluated.eligibilityStatus,
      fitScore: evaluated.fitScore,
      scoreBreakdownJson: JSON.stringify(evaluated.scoreBreakdown),
      requirementsSummaryJson: JSON.stringify(evaluated.evaluations),
      reasonsJson: JSON.stringify(evaluated.reasons),
      risksJson: JSON.stringify({
        flags: evaluated.risks,
        notes: evaluated.riskNotes,
      }),
      missingInformationJson: JSON.stringify(evaluated.missingInformation),
      dataConfidence: evaluated.dataConfidence,
      matchingEngineVersion: MATCHING_ENGINE_VERSION,
      curatorStatus: "NEEDS_REVIEW",
    },
    update: {
      eligibilityStatus: evaluated.eligibilityStatus,
      fitScore: evaluated.fitScore,
      scoreBreakdownJson: JSON.stringify(evaluated.scoreBreakdown),
      requirementsSummaryJson: JSON.stringify(evaluated.evaluations),
      reasonsJson: JSON.stringify(evaluated.reasons),
      risksJson: JSON.stringify({
        flags: evaluated.risks,
        notes: evaluated.riskNotes,
      }),
      missingInformationJson: JSON.stringify(evaluated.missingInformation),
      dataConfidence: evaluated.dataConfidence,
      generatedAt: new Date(),
      matchingEngineVersion: MATCHING_ENGINE_VERSION,
    },
  });

  return evaluated;
}
