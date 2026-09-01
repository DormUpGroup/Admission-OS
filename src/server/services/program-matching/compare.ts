import { cefrAtLeast, parseCefr } from "@/lib/program-matching/taxonomy";
import type { RequirementEvalStatus } from "@/lib/program-matching/types";

export const UNKNOWN = "UNKNOWN" as const;

export function isUnknown(value: unknown): value is "UNKNOWN" {
  return value === UNKNOWN || value === null || value === undefined || value === "";
}

export function compareNumericRequirement(
  studentValue: number | "UNKNOWN" | null | undefined,
  operator: string | null | undefined,
  required: number | null | undefined
): RequirementEvalStatus {
  if (required == null) return "UNKNOWN";
  if (isUnknown(studentValue) || typeof studentValue !== "number") return "UNKNOWN";
  const op = operator || ">=";
  switch (op) {
    case ">=":
      return studentValue >= required ? "MET" : "NOT_MET";
    case ">":
      return studentValue > required ? "MET" : "NOT_MET";
    case "<=":
      return studentValue <= required ? "MET" : "NOT_MET";
    case "<":
      return studentValue < required ? "MET" : "NOT_MET";
    case "=":
    case "==":
      return studentValue === required ? "MET" : "NOT_MET";
    default:
      return "UNKNOWN";
  }
}

export function compareLanguageLevel(
  studentLevel: string | "UNKNOWN" | null | undefined,
  requiredLevel: string | null | undefined
): RequirementEvalStatus {
  if (!requiredLevel) return "UNKNOWN";
  const required = parseCefr(requiredLevel);
  if (!required) return "UNKNOWN";
  if (isUnknown(studentLevel)) return "UNKNOWN";
  const actual = parseCefr(String(studentLevel));
  if (!actual) return "UNKNOWN";
  return cefrAtLeast(actual, required) ? "MET" : "NOT_MET";
}

export function parseIeltsFromText(raw: string | null | undefined): number | "UNKNOWN" {
  if (!raw) return UNKNOWN;
  const m = raw.match(/ielts[^0-9]{0,12}(\d(?:[.,]\d)?)/i) || raw.match(/\b(\d(?:[.,]\d)?)\s*(?:ielts)?/i);
  if (!m) {
    const only = raw.match(/^\s*(\d(?:[.,]\d)?)\s*$/);
    if (!only) return UNKNOWN;
    return Number(only[1].replace(",", "."));
  }
  if (!/ielts/i.test(raw) && !/^\s*\d/.test(raw)) return UNKNOWN;
  const n = Number(m[1].replace(",", "."));
  return Number.isFinite(n) ? n : UNKNOWN;
}

export function parseSatFromText(raw: string | null | undefined): number | "UNKNOWN" {
  if (!raw) return UNKNOWN;
  const m = raw.match(/\bsat[^0-9]{0,12}(\d{3,4})\b/i);
  if (!m) return UNKNOWN;
  return Number(m[1]);
}

export function deadlineStatus(
  deadline: Date | string | null | undefined,
  now = new Date()
): "OPEN" | "SOON" | "PASSED" | "UNKNOWN" {
  if (!deadline) return "UNKNOWN";
  const d = deadline instanceof Date ? deadline : new Date(deadline);
  if (Number.isNaN(d.getTime())) return "UNKNOWN";
  if (d.getTime() < now.getTime()) return "PASSED";
  const days = (d.getTime() - now.getTime()) / 86400000;
  if (days <= 21) return "SOON";
  return "OPEN";
}

export function previousAcademicYear(year: string): string | null {
  const m = year.match(/^(\d{4})\s*\/\s*(\d{4})$/);
  if (!m) return null;
  const start = Number(m[1]) - 1;
  const end = Number(m[2]) - 1;
  return `${start}/${end}`;
}

export function normalizeAcademicYear(year: string | null | undefined): string | null {
  if (!year) return null;
  const m = year.match(/(\d{4})\s*\/\s*(\d{2,4})/);
  if (!m) return null;
  const start = m[1];
  const endRaw = m[2];
  const end = endRaw.length === 2 ? `${start.slice(0, 2)}${endRaw}` : endRaw;
  return `${start}/${end}`;
}
