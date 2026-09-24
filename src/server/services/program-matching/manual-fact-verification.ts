/**
 * OPERATIONAL: Prisma reference implementation for product-rule unit tests and
 * offline tooling. User-reachable verification goes through FastAPI
 * POST /v1/program-facts/verify (server action is a BFF wrapper).
 */
import { prisma } from "@/lib/db";
import type { ApplicantCategory } from "@/lib/program-matching/types";
import { upsertSourceDocument } from "@/server/services/program-ingestion/snapshot";
import {
  assertSafeHttpUrl,
  isSameUniversityDomain,
} from "@/server/services/program-enrichment/url-safety";
import {
  factDimensionKey,
  PROGRAMME_FACT_RESOLVER_VERSION,
} from "./programme-fact-contract";

const VERIFIABLE_CATEGORIES = [
  "EU_CITIZEN",
  "EU_EQUIVALENT",
  "NON_EU_RESIDENT_ITALY",
  "NON_EU_RESIDENT_ABROAD",
] as const;

export async function verifyProgramDossierFacts(input: {
  actorUserId: string;
  studentId: string;
  programAcademicYearId: string;
  explicitCategory: string;
  deadline: string;
  tuitionMin: string;
  tuitionMax: string;
  accessMode: string;
  nonEuSeats: string;
  examsDisplay: string;
  manualSourceUrl: string;
  evidenceQuote: string;
}) {
  if (!input.programAcademicYearId) {
    throw new Error("Missing programAcademicYearId");
  }
  const explicitCategory = input.explicitCategory as ApplicantCategory;
  const matchingProfile = input.studentId
    ? await import("./program-matching").then(({ buildMatchingProfile }) =>
        buildMatchingProfile(input.studentId)
      )
    : null;
  const applicantCategory =
    explicitCategory || matchingProfile?.applicantCategory || "UNKNOWN";
  if (
    !(VERIFIABLE_CATEGORIES as readonly string[]).includes(applicantCategory)
  ) {
    throw new Error("Applicant category is required for manual verification");
  }

  const pay = await prisma.programAcademicYear.findUnique({
    where: { id: input.programAcademicYearId },
    include: {
      program: {
        select: { officialUrl: true, universityId: true, name: true },
      },
      facts: { where: { superseded: false } },
    },
  });
  if (!pay) throw new Error("Program academic year not found");
  const programmeYear = pay;

  const deadlineRaw = input.deadline.trim();
  const tuitionMinRaw = input.tuitionMin.trim();
  const tuitionMaxRaw = input.tuitionMax.trim();
  const accessMode = (input.accessMode || "UNKNOWN").toUpperCase();
  const nonEuSeatsRaw = input.nonEuSeats.trim();
  const examsDisplay = input.examsDisplay.trim();
  const manualSourceUrl = input.manualSourceUrl.trim();
  const evidenceQuote = input.evidenceQuote.trim();
  if (!manualSourceUrl || !evidenceQuote) {
    throw new Error("Official source URL and evidence quote are required");
  }
  const sourceSafety = assertSafeHttpUrl(manualSourceUrl);
  const officialSafety = programmeYear.program.officialUrl
    ? assertSafeHttpUrl(programmeYear.program.officialUrl)
    : null;
  if (
    !sourceSafety.ok ||
    (officialSafety?.ok &&
      !isSameUniversityDomain(
        sourceSafety.url.hostname,
        officialSafety.url.hostname
      ))
  ) {
    throw new Error("Manual verification source must be on the official domain");
  }
  const manualSource = await upsertSourceDocument({
    sourceType: "MANUAL_VERIFIED",
    sourceAuthority: programmeYear.program.name,
    url: manualSourceUrl,
    academicYear: programmeYear.academicYear,
    universityId: programmeYear.program.universityId,
    programId: programmeYear.programId,
    programAcademicYearId: programmeYear.id,
    contentType: "manual-quote",
    body: evidenceQuote,
    status: "VERIFIED",
    extractionQuality: "MANUAL_VERIFIED",
  });

  const deadline = deadlineRaw ? new Date(`${deadlineRaw}T12:00:00Z`) : null;
  const tuitionMin = tuitionMinRaw ? Number(tuitionMinRaw) : null;
  const tuitionMax = tuitionMaxRaw ? Number(tuitionMaxRaw) : null;
  const nonEuSeats = nonEuSeatsRaw ? Number(nonEuSeatsRaw) : null;

  async function writeVerifiedFact(
    field: string,
    value: unknown,
    rawValue?: string,
    discriminator = "primary"
  ) {
    const dimensionKey = factDimensionKey({
      field,
      scope: applicantCategory,
      discriminator,
    });
    const existing = await prisma.programFact.findFirst({
      where: {
        programId: programmeYear.programId,
        programAcademicYearId: programmeYear.id,
        field,
        superseded: false,
        applicantCategoryScope: applicantCategory,
        dimensionKey,
      },
    });
    if (existing && existing.sourceType !== "MANUAL_VERIFIED") {
      await prisma.programFact.update({
        where: { id: existing.id },
        data: { superseded: true },
      });
    }
    const data = {
      normalizedValueJson: JSON.stringify(value),
      rawValue: rawValue ?? null,
      sourceType: "MANUAL_VERIFIED",
      confidence: "HIGH",
      extractionMethod: "MANUAL",
      verificationStatus: "VERIFIED",
      sourceDocumentId: manualSource.document.id,
      sourceUrl: manualSourceUrl,
      evidenceQuote,
      evidenceValidatedAt: new Date(),
      applicantCategoryScope: applicantCategory,
      freshness: "CURRENT",
      origin: "MANUAL_VERIFIED",
      dimensionKey,
      decisionStatus: "ELIGIBLE",
      resolverVersion: PROGRAMME_FACT_RESOLVER_VERSION,
      verifiedById: input.actorUserId,
      verifiedAt: new Date(),
      retrievedAt: new Date(),
    };
    if (existing?.sourceType === "MANUAL_VERIFIED") {
      await prisma.programFact.update({
        where: { id: existing.id },
        data,
      });
    } else {
      await prisma.programFact.create({
        data: {
          programId: programmeYear.programId,
          programAcademicYearId: programmeYear.id,
          field,
          academicYear: programmeYear.academicYear,
          ...data,
        },
      });
    }
  }

  if (deadline && !Number.isNaN(deadline.getTime())) {
    await writeVerifiedFact(
      "APPLICATION_DEADLINE",
      {
        date: deadline.toISOString(),
        roundName: "Primary",
      },
      deadlineRaw,
      "primary"
    );
  }

  if (nonEuSeats != null && Number.isFinite(nonEuSeats)) {
    await writeVerifiedFact(
      "SEATS",
      {
        places: nonEuSeats,
        category: applicantCategory,
        originalGroup: "Manual curator verification",
      },
      `Manual: ${nonEuSeats} places for ${applicantCategory}`,
      applicantCategory
    );
  }

  if (
    (tuitionMin != null && Number.isFinite(tuitionMin)) ||
    (tuitionMax != null && Number.isFinite(tuitionMax))
  ) {
    const minVal =
      tuitionMin != null && Number.isFinite(tuitionMin) ? tuitionMin : null;
    const maxVal =
      tuitionMax != null && Number.isFinite(tuitionMax) ? tuitionMax : null;
    const fixed =
      minVal != null && maxVal != null && minVal === maxVal ? minVal : null;
    await writeVerifiedFact(
      "TUITION",
      {
        min: minVal,
        max: maxVal,
        fixed,
      },
      undefined,
      "annual"
    );
  }

  if (accessMode === "OPEN" || accessMode === "CLOSED") {
    await writeVerifiedFact(
      "ACCESS_TYPE",
      {
        mode: accessMode,
      },
      accessMode,
      "access"
    );
  }

  if (examsDisplay) {
    await writeVerifiedFact(
      "ADMISSION_EXAMS",
      {
        description: examsDisplay,
        type: /SAT/i.test(examsDisplay)
          ? "SAT"
          : /TOLC/i.test(examsDisplay)
            ? "TOLC"
            : "ADMISSION_TEST",
      },
      examsDisplay,
      examsDisplay
    );
  }
}
