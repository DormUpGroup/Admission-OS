import { prisma } from "@/lib/db";
import type { ApplicantCategory } from "@/lib/program-matching/types";
import { factAppliesToCategory } from "./matching-context";
import {
  CRITICAL_FIELDS,
  FIELD_TO_PROGRAM_FACT,
  type CriticalField,
  type EnrichmentOutput,
} from "./schema";

export function enrichmentFieldsForMode(forShortlist: boolean): CriticalField[] {
  return forShortlist
    ? CRITICAL_FIELDS.filter((field) => field !== "deadlines" && field !== "tuition")
    : [...CRITICAL_FIELDS];
}

export async function findEligibleFactsForCurrentSources(input: {
  programAcademicYearId: string;
  applicantCategory: ApplicantCategory;
  academicYear: string;
  sourceDocumentIds: string[];
  forShortlist?: boolean;
}): Promise<{ coveredFields: CriticalField[]; factIds: string[] }> {
  if (input.sourceDocumentIds.length === 0) {
    return { coveredFields: [], factIds: [] };
  }

  const needed = enrichmentFieldsForMode(input.forShortlist ?? false);
  const facts = await prisma.programFact.findMany({
    where: {
      programAcademicYearId: input.programAcademicYearId,
      superseded: false,
      decisionStatus: "ELIGIBLE",
      sourceDocumentId: { in: input.sourceDocumentIds },
      academicYear: input.academicYear,
      evidenceQuote: { not: null },
      field: { in: needed.map((field) => FIELD_TO_PROGRAM_FACT[field]) },
    },
    select: {
      id: true,
      field: true,
      applicantCategoryScope: true,
      evidenceQuote: true,
      sourceDocumentId: true,
      sourceUrl: true,
    },
  });

  const factToField = new Map(
    needed.map((field) => [FIELD_TO_PROGRAM_FACT[field], field] as const)
  );
  const covered = new Set<CriticalField>();
  const factIds: string[] = [];

  for (const fact of facts) {
    if (!fact.evidenceQuote?.trim() || !fact.sourceDocumentId || !fact.sourceUrl) {
      continue;
    }
    if (!factAppliesToCategory(fact.applicantCategoryScope, input.applicantCategory)) {
      continue;
    }
    const field = factToField.get(fact.field);
    if (!field) continue;
    covered.add(field);
    factIds.push(fact.id);
  }

  return { coveredFields: [...covered], factIds };
}

export function omitResolvedFields(
  output: EnrichmentOutput,
  resolved: CriticalField[]
): EnrichmentOutput {
  if (resolved.length === 0) return output;
  const resolvedSet = new Set<string>(resolved);
  const next: EnrichmentOutput = { ...output };
  for (const field of resolved) {
    next[field] = [];
  }
  next.unresolvedFields = output.unresolvedFields.filter(
    (field) => !resolvedSet.has(field)
  );
  return next;
}
