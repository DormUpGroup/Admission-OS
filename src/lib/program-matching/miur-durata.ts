import { normalizeMiurCode } from "@/lib/program-matching/miur-code";

/**
 * Known single-cycle programme lengths for Universitaly `durata`.
 * Do not dual-query 5+6 for these codes.
 */
export const SINGLE_CYCLE_DURATA_BY_CLASSE: Record<string, string> = {
  "LM-41": "6", // Medicine
  "LM-46": "6", // Dentistry
  "LM-42": "5", // Veterinary
  "LM-13": "5", // Pharmacy
  "LMR/02": "5", // Restoration
};

export function isKnownSingleCycleClasse(code: string): boolean {
  return normalizeMiurCode(code) in SINGLE_CYCLE_DURATA_BY_CLASSE;
}

/**
 * Resolve Universitaly durata for a MIUR classe + profile degree level.
 * Unknown SINGLE_CYCLE codes default to "5" (caller may retry "6" if empty).
 */
export function durataForClasse(
  code: string | null | undefined,
  degreeLevel?: string | null
): string {
  if (code) {
    const mapped = SINGLE_CYCLE_DURATA_BY_CLASSE[normalizeMiurCode(code)];
    if (mapped) return mapped;
  }
  const level = (degreeLevel ?? "BACHELOR").toUpperCase();
  if (level === "MASTER") return "2";
  if (level === "SINGLE_CYCLE") return "5";
  if (level === "BACHELOR" || level === "FOUNDATION") return "3";
  return "3";
}
