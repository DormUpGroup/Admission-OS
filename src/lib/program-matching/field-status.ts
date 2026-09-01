export type FieldUnknownReason =
  | "NOT_PUBLISHED_FOR_TARGET_YEAR"
  | "ONLY_PREVIOUS_YEAR_AVAILABLE"
  | "OFFICIAL_SOURCE_NOT_FOUND"
  | "SOURCE_FETCH_FAILED"
  | "SCANNED_PDF_NEEDS_OCR"
  | "OFFICIAL_SOURCE_DOES_NOT_STATE_FIELD"
  | "CURATOR_CONFIRMATION_NEEDED";

export type CriticalProgramField =
  | "teachingLanguage"
  | "languageRequirement"
  | "access"
  | "selection"
  | "exams"
  | "tuition"
  | "deadline"
  | "seats"
  | "admissionCall";

export type FieldFreshness = "current" | "indicative";
export type FieldScope = "programme" | "university-wide";

export type ProgramFieldStatus<T = unknown> = {
  value: T | null;
  reason: FieldUnknownReason | null;
  sourceUrl: string | null;
  sourceAcademicYear: string | null;
  targetIntakeYear: string;
  sourceType: string | null;
  extractionQuality: string | null;
  parserVersion: string | null;
  freshness: FieldFreshness | null;
  scope: FieldScope | null;
};

export type ProgramFieldStatusMap = Record<
  CriticalProgramField,
  ProgramFieldStatus<unknown>
>;

export const CRITICAL_PROGRAM_FIELDS: CriticalProgramField[] = [
  "teachingLanguage",
  "languageRequirement",
  "access",
  "selection",
  "exams",
  "tuition",
  "deadline",
  "seats",
  "admissionCall",
];

export function isFieldFilled(status: ProgramFieldStatus<unknown>): boolean {
  const v = status.value;
  if (v == null) return false;
  if (typeof v === "string") return v.trim().length > 0;
  if (Array.isArray(v)) return v.length > 0;
  if (typeof v === "object" && v !== null && "filled" in v) {
    return Boolean((v as { filled?: boolean }).filled);
  }
  return true;
}

export function isFieldExplained(status: ProgramFieldStatus<unknown>): boolean {
  if (isFieldFilled(status)) return true;
  if (!status.reason) return false;
  if (
    status.reason === "OFFICIAL_SOURCE_NOT_FOUND" ||
    status.reason === "SOURCE_FETCH_FAILED" ||
    status.reason === "SCANNED_PDF_NEEDS_OCR"
  ) {
    return true;
  }
  return Boolean(status.sourceUrl || status.sourceAcademicYear);
}

export function emptyFieldStatus(
  targetIntakeYear: string
): ProgramFieldStatus<unknown> {
  return {
    value: null,
    reason: null,
    sourceUrl: null,
    sourceAcademicYear: null,
    targetIntakeYear,
    sourceType: null,
    extractionQuality: null,
    parserVersion: null,
    freshness: null,
    scope: null,
  };
}

export function buildEmptyFieldStatusMap(
  targetIntakeYear: string
): ProgramFieldStatusMap {
  return CRITICAL_PROGRAM_FIELDS.reduce((acc, field) => {
    acc[field] = emptyFieldStatus(targetIntakeYear);
    return acc;
  }, {} as ProgramFieldStatusMap);
}

/** Normalise "2027/28", "2027/2028", "2027-2028" → start year number. */
export function academicYearStart(year: string | null | undefined): number {
  if (!year) return 0;
  const m = year.match(/(20\d{2})/);
  return m ? Number(m[1]) : 0;
}

export function isPreviousAcademicYear(
  sourceYear: string | null | undefined,
  targetIntakeYear: string
): boolean {
  const sourceStart = academicYearStart(sourceYear);
  const targetStart = academicYearStart(targetIntakeYear);
  return sourceStart > 0 && targetStart > 0 && sourceStart < targetStart;
}
