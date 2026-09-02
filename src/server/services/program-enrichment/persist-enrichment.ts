import { prisma } from "@/lib/db";
import { regionForCity } from "@/lib/program-matching/taxonomy";
import type { ApplicantCategory } from "@/lib/program-matching/types";
import {
  factAppliesToCategory,
  scopeForApplicantCategory,
} from "./matching-context";
import { validateEvidenceQuote } from "./quote-validator";
import {
  FIELD_TO_PROGRAM_FACT,
  type CriticalField,
  type EnrichmentOutput,
  type EvidenceFact,
} from "./schema";

export type PersistEnrichmentResult = {
  savedFields: string[];
  quoteRejectCount: number;
  conflicts: number;
  campusesUpdated: boolean;
};

function serializeValue(value: unknown): string {
  return JSON.stringify(value);
}

async function supersedeAutomaticFact(input: {
  programId: string;
  programAcademicYearId: string;
  field: string;
  applicantCategoryScope: string;
}) {
  const existing = await prisma.programFact.findMany({
    where: {
      programId: input.programId,
      programAcademicYearId: input.programAcademicYearId,
      field: input.field,
      superseded: false,
      applicantCategoryScope: input.applicantCategoryScope,
    },
  });
  for (const fact of existing) {
    if (
      fact.verificationStatus === "VERIFIED" ||
      fact.sourceType === "MANUAL_VERIFIED" ||
      fact.extractionMethod === "MANUAL"
    ) {
      continue;
    }
    await prisma.programFact.update({
      where: { id: fact.id },
      data: { superseded: true },
    });
  }
  return existing.filter(
    (f) =>
      f.verificationStatus === "VERIFIED" ||
      f.sourceType === "MANUAL_VERIFIED" ||
      f.extractionMethod === "MANUAL"
  );
}

export async function persistEnrichmentOutput(input: {
  programId: string;
  programAcademicYearId: string;
  academicYear: string;
  applicantCategory: ApplicantCategory;
  output: EnrichmentOutput;
  documentTexts: Map<string, string>;
  extractionMethod: string;
}): Promise<PersistEnrichmentResult> {
  const savedFields: string[] = [];
  let quoteRejectCount = 0;
  let campusesUpdated = false;
  const profileScope = scopeForApplicantCategory(input.applicantCategory);
  const allowCategorySpecific = input.applicantCategory !== "UNKNOWN";

  const groups: Array<[CriticalField, EvidenceFact[]]> = [
    ["campuses", input.output.campuses],
    ["access", input.output.access],
    ["admissionExams", input.output.admissionExams],
    ["languageRequirements", input.output.languageRequirements],
    ["deadlines", input.output.deadlines],
    ["tuition", input.output.tuition],
    ["seats", input.output.seats],
    ["requiredDocuments", input.output.requiredDocuments],
  ];

  const campusEntries: Array<{
    name?: string;
    city: string;
    sourceDocumentId: string;
    sourceUrl: string;
    quote: string;
  }> = [];

  for (const [group, facts] of groups) {
    const field = FIELD_TO_PROGRAM_FACT[group];
    for (const fact of facts) {
      if (!allowCategorySpecific && fact.scope !== "ALL") {
        continue;
      }
      if (
        input.applicantCategory !== "UNKNOWN" &&
        fact.scope !== "ALL" &&
        !factAppliesToCategory(fact.scope, input.applicantCategory)
      ) {
        continue;
      }

      const docText = input.documentTexts.get(fact.sourceDocumentId);
      const quoteCheck = validateEvidenceQuote(fact.quote, docText);
      if (!quoteCheck.accepted) {
        quoteRejectCount += 1;
        continue;
      }

      const scope =
        fact.scope === "ALL" ? "ALL" : fact.scope || profileScope;

      const protectedFacts = await supersedeAutomaticFact({
        programId: input.programId,
        programAcademicYearId: input.programAcademicYearId,
        field,
        applicantCategoryScope: scope,
      });
      if (protectedFacts.length > 0) {
        // MANUAL_VERIFIED wins — do not write automatic replacement
        continue;
      }

      const oldFacts = await prisma.programFact.findMany({
        where: {
          programId: input.programId,
          programAcademicYearId: input.programAcademicYearId,
          field,
          superseded: true,
          applicantCategoryScope: scope,
        },
        orderBy: { retrievedAt: "desc" },
        take: 1,
      });

      const created = await prisma.programFact.create({
        data: {
          programId: input.programId,
          programAcademicYearId: input.programAcademicYearId,
          field,
          normalizedValueJson: serializeValue(fact.value),
          rawValue: String(fact.value).slice(0, 500),
          evidenceQuote: fact.quote.slice(0, 1000),
          applicantCategoryScope: scope,
          freshness: fact.freshness,
          extractionMetadataJson: JSON.stringify({
            confidence: fact.confidence,
            group,
          }),
          sourceDocumentId: fact.sourceDocumentId,
          sourceUrl: fact.sourceUrl,
          sourceType:
            group === "deadlines" || group === "tuition" || group === "seats"
              ? "ADMISSION_CALL"
              : "PROGRAMME_PAGE",
          academicYear: fact.academicYear || input.academicYear,
          confidence: fact.confidence,
          extractionMethod: input.extractionMethod,
          verificationStatus: "UNVERIFIED",
        },
      });

      if (
        oldFacts[0] &&
        oldFacts[0].normalizedValueJson !== created.normalizedValueJson
      ) {
        await prisma.programChangeEvent.create({
          data: {
            sourceDocumentId: fact.sourceDocumentId,
            programId: input.programId,
            programAcademicYearId: input.programAcademicYearId,
            field,
            oldValue: oldFacts[0].normalizedValueJson,
            newValue: created.normalizedValueJson,
            severity: "MATERIAL",
          },
        });
      }

      savedFields.push(field);

      if (group === "campuses") {
        const city =
          typeof fact.value === "string"
            ? fact.value
            : fact.value &&
                typeof fact.value === "object" &&
                "city" in (fact.value as object)
              ? String((fact.value as { city: unknown }).city)
              : null;
        if (city?.trim()) {
          campusEntries.push({
            name:
              fact.value &&
              typeof fact.value === "object" &&
              "name" in (fact.value as object)
                ? String((fact.value as { name?: unknown }).name ?? "")
                : undefined,
            city: city.trim(),
            sourceDocumentId: fact.sourceDocumentId,
            sourceUrl: fact.sourceUrl,
            quote: fact.quote,
          });
        }
      }
    }
  }

  for (const conflict of input.output.sourceConflicts) {
    await prisma.programFact.create({
      data: {
        programId: input.programId,
        programAcademicYearId: input.programAcademicYearId,
        field: "SOURCE_CONFLICT",
        normalizedValueJson: JSON.stringify(conflict),
        rawValue: conflict.description.slice(0, 500),
        evidenceQuote: conflict.description.slice(0, 1000),
        applicantCategoryScope: "ALL",
        freshness: "CONFLICT",
        sourceType: "PROGRAMME_PAGE",
        academicYear: input.academicYear,
        confidence: "LOW",
        extractionMethod: input.extractionMethod,
        verificationStatus: "UNVERIFIED",
      },
    });
  }

  if (campusEntries.length > 0) {
    const uniqueCities = [...new Set(campusEntries.map((c) => c.city))];
    await prisma.program.update({
      where: { id: input.programId },
      data: {
        campusesJson: JSON.stringify(campusEntries),
        campusCity: uniqueCities.length === 1 ? uniqueCities[0] : null,
        region:
          uniqueCities.length === 1
            ? regionForCity(uniqueCities[0])
            : undefined,
      },
    });
    campusesUpdated = true;
  }

  return {
    savedFields: [...new Set(savedFields)],
    quoteRejectCount,
    conflicts: input.output.sourceConflicts.length,
    campusesUpdated,
  };
}
