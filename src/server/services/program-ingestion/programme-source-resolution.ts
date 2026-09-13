import { prisma } from "@/lib/db";
import type { ResolvedProgrammeSource } from "./programme-source-resolver";

export const PROGRAMME_SOURCE_RESOLUTION_FIELD = "PROGRAMME_SOURCE_RESOLUTION";

/**
 * This fact is the boundary between discovery and decision making. A URL from
 * Universitaly alone is a lead; only an exact programme page resolved on an
 * official university property may unlock shortlist actions.
 */
export async function recordProgrammeSourceResolution(input: {
  programId: string;
  programAcademicYearId: string;
  academicYear: string;
  programmeName: string;
  resolution: ResolvedProgrammeSource;
}) {
  const existing = await prisma.programFact.findFirst({
    where: {
      programAcademicYearId: input.programAcademicYearId,
      field: PROGRAMME_SOURCE_RESOLUTION_FIELD,
      superseded: false,
    },
  });
  const data = {
    normalizedValueJson: JSON.stringify({
      url: input.resolution.url,
      method: input.resolution.method,
    }),
    rawValue: input.resolution.url,
    evidenceQuote: input.programmeName,
    sourceUrl: input.resolution.url,
    sourceType: "PROGRAMME_PAGE",
    academicYear: input.academicYear,
    freshness: "CURRENT",
    origin: "OFFICIAL_FALLBACK",
    decisionStatus: "ELIGIBLE",
    evidenceValidatedAt: new Date(),
    confidence: "HIGH",
    extractionMethod: "SOURCE_RESOLVER",
    verificationStatus: "VERIFIED",
    retrievedAt: new Date(),
  };
  if (existing) {
    return prisma.programFact.update({ where: { id: existing.id }, data });
  }
  return prisma.programFact.create({
    data: {
      programId: input.programId,
      programAcademicYearId: input.programAcademicYearId,
      field: PROGRAMME_SOURCE_RESOLUTION_FIELD,
      ...data,
    },
  });
}

export async function getProgrammeSelectionReadiness(
  programAcademicYearId: string
): Promise<{ ready: boolean; reason: string }> {
  const source = await prisma.programFact.findFirst({
    where: {
      programAcademicYearId,
      superseded: false,
      decisionStatus: "ELIGIBLE",
      sourceUrl: { not: null },
      evidenceQuote: { not: null },
      OR: [
        {
          field: PROGRAMME_SOURCE_RESOLUTION_FIELD,
          freshness: "CURRENT",
        },
        {
          origin: "MANUAL_VERIFIED",
          verificationStatus: "VERIFIED",
        },
      ],
    },
    select: { id: true },
  });
  if (!source) {
    return {
        ready: false,
        reason:
          "Programme source is not resolved. Run source verification or confirm the programme page manually before shortlisting.",
      };
  }
  const decisionFact = await prisma.programFact.findFirst({
    where: {
      programAcademicYearId,
      superseded: false,
      decisionStatus: "ELIGIBLE",
      freshness: "CURRENT",
      sourceUrl: { not: null },
      evidenceQuote: { not: null },
      field: {
        in: [
          "ACCESS_TYPE",
          "ADMISSION_REGIME",
          "SELECTION",
          "ADMISSION_EXAMS",
          "SEATS",
          "APPLICATION_DEADLINE",
        ],
      },
    },
    select: { id: true },
  });
  return decisionFact
    ? { ready: true, reason: "" }
    : {
        ready: false,
        reason:
          "Programme has no verified current admission evidence. It may be monitored, but cannot be shortlisted or used for an application yet.",
      };
}
