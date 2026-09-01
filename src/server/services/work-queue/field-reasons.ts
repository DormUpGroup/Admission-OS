import type { FieldUnknownReason } from "@/lib/program-matching/field-status";
import { formatAcademicYearShort } from "@/server/services/student-journey/humanize";

export function unknownFieldReasonLabel(
  reason: FieldUnknownReason | null | undefined,
  targetYear?: string | null
): string {
  switch (reason) {
    case "NOT_PUBLISHED_FOR_TARGET_YEAR": {
      const year = formatAcademicYearShort(targetYear);
      return year
        ? `Условия ${year} ещё не опубликованы`
        : "Условия выбранного года ещё не опубликованы";
    }
    case "ONLY_PREVIOUS_YEAR_AVAILABLE":
      return "Есть ориентир за прошлый год";
    case "OFFICIAL_SOURCE_NOT_FOUND":
    case "SOURCE_FETCH_FAILED":
    case "OFFICIAL_SOURCE_DOES_NOT_STATE_FIELD":
    case "SCANNED_PDF_NEEDS_OCR":
      return "Нужна проверка источника";
    case "CURATOR_CONFIRMATION_NEEDED":
      return "Нужна ручная проверка куратора";
    default:
      return "Нужна ручная проверка куратора";
  }
}

export function inferUnknownReason(input: {
  hasValue: boolean;
  indicativeFromYear?: string | null;
  academicYear?: string | null;
  intake?: string | null;
  verified?: boolean;
}): FieldUnknownReason | null {
  if (input.hasValue) return null;
  if (input.verified) return "CURATOR_CONFIRMATION_NEEDED";
  if (input.indicativeFromYear) return "ONLY_PREVIOUS_YEAR_AVAILABLE";
  const sourceYear = input.academicYear ?? "";
  const intake = input.intake ?? "";
  const sourceStart = Number((sourceYear.match(/20\d{2}/) || [])[0]);
  const intakeStart = Number((intake.match(/20\d{2}/) || [])[0]);
  if (sourceStart && intakeStart && sourceStart < intakeStart) {
    return "NOT_PUBLISHED_FOR_TARGET_YEAR";
  }
  return "CURATOR_CONFIRMATION_NEEDED";
}
