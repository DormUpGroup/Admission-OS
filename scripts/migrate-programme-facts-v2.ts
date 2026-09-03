import { prisma } from "../src/lib/db";
import type { ApplicantCategory } from "../src/lib/program-matching/types";
import {
  PROGRAMME_FACT_RESOLVER_VERSION,
} from "../src/server/services/program-matching/programme-fact-contract";
import { validateEvidenceQuote } from "../src/server/services/program-enrichment/quote-validator";
import {
  enrichProgramWithAi,
  isProgramEnrichmentEnabled,
} from "../src/server/services/program-enrichment";

const apply = process.argv.includes("--apply");
const reenrich = process.argv.includes("--reenrich");
const limitArg = process.argv.find((arg) => arg.startsWith("--limit="));
const limit = Math.max(1, Number(limitArg?.split("=")[1] || 50));

const categories: ApplicantCategory[] = [
  "EU_CITIZEN",
  "EU_EQUIVALENT",
  "NON_EU_RESIDENT_ITALY",
  "NON_EU_RESIDENT_ABROAD",
];

function normalizeAcademicYear(value: string): string {
  const short = value.trim().match(/^(\d{4})\/(\d{2})$/);
  return short ? `${short[1]}/20${short[2]}` : value.trim();
}

async function backfillApplicationYears() {
  const applications = await prisma.application.findMany({
    where: { programAcademicYearId: null },
    include: {
      program: {
        select: { academicYears: { select: { id: true, academicYear: true } } },
      },
    },
  });
  let matched = 0;
  for (const application of applications) {
    const target = normalizeAcademicYear(application.intake);
    const candidates = application.program.academicYears.filter(
      (year) => year.academicYear === target
    );
    if (candidates.length !== 1) continue;
    matched += 1;
    if (apply) {
      await prisma.application.update({
        where: { id: application.id },
        data: { programAcademicYearId: candidates[0].id },
      });
    }
  }
  return { eligible: matched, totalUnlinked: applications.length };
}

async function classifyExistingFacts() {
  const facts = await prisma.programFact.findMany({
    include: { sourceDocument: { select: { rawText: true } } },
  });
  const counts = {
    manual: 0,
    aiEligible: 0,
    fallbackEligible: 0,
    legacyCandidate: 0,
  };

  for (const fact of facts) {
    const manual =
      fact.sourceType === "MANUAL_VERIFIED" ||
      (fact.verificationStatus === "VERIFIED" &&
        fact.extractionMethod === "MANUAL");
    const ai = fact.extractionMethod.startsWith("OPENAI_");
    const officialFallback =
      !ai &&
      ["ADMISSION_CALL", "PROGRAMME_PAGE"].includes(fact.sourceType) &&
      /^(HTML_|PDF_|OCR_|FALLBACK_)/.test(fact.extractionMethod);
    const requiresQuotaReenrichment =
      fact.field === "SEATS" &&
      fact.resolverVersion !== PROGRAMME_FACT_RESOLVER_VERSION;
    const evidenceOk =
      !!fact.sourceDocumentId &&
      !!fact.sourceUrl &&
      !!fact.evidenceQuote &&
      !!fact.academicYear &&
      !!fact.applicantCategoryScope &&
      fact.freshness === "CURRENT" &&
      validateEvidenceQuote(
        fact.evidenceQuote || "",
        fact.sourceDocument?.rawText || ""
      ).accepted;

    const data = manual
      ? {
          origin: "MANUAL_VERIFIED",
          decisionStatus: "ELIGIBLE",
          resolverVersion: PROGRAMME_FACT_RESOLVER_VERSION,
        }
      : evidenceOk && ai && !requiresQuotaReenrichment
        ? {
            origin: "AI",
            decisionStatus: "ELIGIBLE",
            evidenceValidatedAt: fact.evidenceValidatedAt ?? new Date(),
            resolverVersion: PROGRAMME_FACT_RESOLVER_VERSION,
          }
        : evidenceOk && officialFallback && !requiresQuotaReenrichment
          ? {
              origin: "OFFICIAL_FALLBACK",
              decisionStatus: "ELIGIBLE",
              evidenceValidatedAt: fact.evidenceValidatedAt ?? new Date(),
              resolverVersion: PROGRAMME_FACT_RESOLVER_VERSION,
            }
          : {
              origin: "LEGACY_CANDIDATE",
              decisionStatus:
                fact.freshness === "CONFLICT" ? "CONFLICT" : "LEGACY_CANDIDATE",
              evidenceValidatedAt: null,
              resolverVersion: PROGRAMME_FACT_RESOLVER_VERSION,
            };

    if (data.origin === "MANUAL_VERIFIED") counts.manual += 1;
    else if (data.origin === "AI") counts.aiEligible += 1;
    else if (data.origin === "OFFICIAL_FALLBACK") counts.fallbackEligible += 1;
    else counts.legacyCandidate += 1;

    if (apply) {
      await prisma.programFact.update({ where: { id: fact.id }, data });
    }
  }
  return counts;
}

async function reenrichProgrammes() {
  if (!reenrich) return { attempted: 0, succeeded: 0 };
  if (!apply) {
    console.log("Re-enrichment is skipped in dry-run mode; add --apply.");
    return { attempted: 0, succeeded: 0 };
  }
  if (!isProgramEnrichmentEnabled()) {
    console.log("Re-enrichment is skipped because OpenAI enrichment is disabled.");
    return { attempted: 0, succeeded: 0 };
  }

  const years = await prisma.programAcademicYear.findMany({
    where: { program: { officialUrl: { not: null } } },
    include: { program: { include: { university: true } } },
    orderBy: { updatedAt: "desc" },
    take: limit,
  });
  let attempted = 0;
  let succeeded = 0;
  for (const pay of years) {
    for (const applicantCategory of categories) {
      attempted += 1;
      const result = await enrichProgramWithAi({
        programAcademicYearId: pay.id,
        applicantCategory,
        force: true,
        matchingContext: {
          targetAcademicYear: pay.academicYear,
          degreeLevel: pay.program.degreeLevel,
          applicantCategory,
          directions: [],
          miurCodes: [],
          preferredTeachingLanguages: [],
          preferredCities: [],
          excludedCities: [],
          maxTuition: null,
          program: {
            name: pay.program.name,
            universityName: pay.program.university.name,
            degreeClass: pay.program.degreeClass,
            language: pay.program.language,
            durationYears: null,
            campusCity: null,
            officialUrl: pay.program.officialUrl,
          },
        },
      });
      if (result.status === "SUCCEEDED" || result.status === "REUSED") {
        succeeded += 1;
      }
    }
  }
  return { attempted, succeeded };
}

async function main() {
  console.log(apply ? "Applying programme facts v2 migration." : "Dry run only.");
  const classified = await classifyExistingFacts();
  console.log({ classified });
  const applications = await backfillApplicationYears();
  console.log({ applications });
  const enrichment = await reenrichProgrammes();
  console.log({ enrichment });
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
