import type { ApplicantCategory } from "@/lib/program-matching/types";

export const PROGRAMME_FACT_RESOLVER_VERSION = "v2";

export const DECISION_FACT_FIELDS = [
  "ACCESS_TYPE",
  "SELECTION",
  "APPLICATION_DEADLINE",
  "TUITION",
  "SEATS",
  "ADMISSION_EXAMS",
  "LANGUAGE_REQUIREMENT",
  "REQUIRED_DOCUMENTS",
  "CAMPUS",
] as const;

export type DecisionFactField = (typeof DECISION_FACT_FIELDS)[number];
export type ApplicantScope = ApplicantCategory | "ALL";
export type ProgrammeFactOrigin =
  | "AI"
  | "OFFICIAL_FALLBACK"
  | "MANUAL_VERIFIED"
  | "LEGACY_CANDIDATE"
  | "DISCOVERY";

export type QuotaFactValue = {
  places: number;
  category: Exclude<ApplicantCategory, "UNKNOWN"> | "UNMAPPED";
  originalGroup: string;
  categoryCode?: string | null;
};

export type DeadlineFactValue = {
  date: string;
  roundName?: string | null;
};

export type TuitionFactValue = {
  min?: number | null;
  max?: number | null;
  fixed?: number | null;
  currency?: string;
  notes?: string | null;
};

export function isDecisionFactField(field: string): field is DecisionFactField {
  return (DECISION_FACT_FIELDS as readonly string[]).includes(field);
}

/**
 * Category mappings are intentionally exact. EU equivalents remain a distinct
 * scope; mixed or unknown official groups are never guessed.
 */
export function factScopeApplies(
  scope: string | null | undefined,
  category: ApplicantCategory
): boolean {
  if (scope === "ALL") return category !== "UNKNOWN";
  if (!scope || category === "UNKNOWN") return false;
  return scope === category;
}

export function factDimensionKey(input: {
  field: string;
  scope: string;
  roundName?: string | null;
  categoryCode?: string | null;
  discriminator?: string | null;
}): string {
  return [
    input.field,
    input.scope,
    input.roundName || "",
    input.categoryCode || "",
    input.discriminator || "",
  ].join(":");
}
