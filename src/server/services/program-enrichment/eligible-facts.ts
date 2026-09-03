import { prisma } from "@/lib/db";
import type { ApplicantCategory } from "@/lib/program-matching/types";
import { factAppliesToCategory } from "./matching-context";
import {
  CRITICAL_FIELDS,
  FIELD_TO_PROGRAM_FACT,
  type CriticalField,
} from "./schema";

/** Administrative groups deferred on the initial curator shortlist. */
export const SHORTLIST_DEFERRED_FIELDS = [
  "deadlines",
  "tuition",
] as const satisfies readonly CriticalField[];

export function enrichmentFieldsForMode(forShortlist: boolean): CriticalField[] {
  if (!forShortlist) return [...CRITICAL_FIELDS];
  const deferred = new Set<string>(SHORTLIST_DEFERRED_FIELDS);
  return CRITICAL_FIELDS.filter((field) => !deferred.has(field));
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
