import { SOURCE_PRIORITY } from "@/lib/program-matching/config";

export type FactCandidate = {
  sourceType: string;
  academicYear?: string | null;
  publishedAt?: Date | string | null;
  retrievedAt?: Date | string | null;
  verificationStatus?: string | null;
  confidence?: string | null;
  superseded?: boolean;
  freshness?: string | null;
  applicantCategoryScope?: string | null;
};

const CONFIDENCE_RANK: Record<string, number> = {
  HIGH: 3,
  MEDIUM: 2,
  LOW: 1,
};

function ts(value: Date | string | null | undefined): number {
  if (!value) return 0;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? 0 : d.getTime();
}

export function factScore(
  fact: FactCandidate,
  targetAcademicYear?: string | null,
  options?: {
    applicantCategory?: string | null;
  }
): number {
  if (fact.superseded) return -1;
  let score = SOURCE_PRIORITY[fact.sourceType] ?? SOURCE_PRIORITY.OTHER;
  if (fact.verificationStatus === "VERIFIED") score += 40;
  if (targetAcademicYear && fact.academicYear === targetAcademicYear) score += 25;
  else if (targetAcademicYear && fact.academicYear && fact.academicYear !== targetAcademicYear)
    score -= 20;
  score += (CONFIDENCE_RANK[fact.confidence ?? "MEDIUM"] ?? 2) * 2;

  const freshness = fact.freshness ?? "UNKNOWN";
  if (freshness === "CURRENT") score += 15;
  else if (freshness === "INDICATIVE") score += 5;
  else if (freshness === "CONFLICT") score -= 30;

  const scope = fact.applicantCategoryScope;
  const cat = options?.applicantCategory;
  if (cat && cat !== "UNKNOWN" && scope) {
    if (scope === "ALL") score += 5;
    else if (scope === cat || (cat === "EU_EQUIVALENT" && scope === "EU_CITIZEN"))
      score += 20;
    else score -= 40;
  }

  score += Math.min(10, Math.floor(ts(fact.publishedAt) / 1e12));
  score += Math.min(5, Math.floor(ts(fact.retrievedAt) / 1e13));
  return score;
}

export function resolveProgramFact<T extends FactCandidate>(
  facts: T[],
  targetAcademicYear?: string | null,
  options?: { applicantCategory?: string | null }
): T | null {
  const ranked = facts
    .filter((f) => !f.superseded)
    .map((f) => ({ f, score: factScore(f, targetAcademicYear, options) }))
    .sort((a, b) => b.score - a.score);
  return ranked[0]?.f ?? null;
}

export function detectStaleness(retrievedAt: Date | string | null, now = new Date()): boolean {
  if (!retrievedAt) return true;
  const d = retrievedAt instanceof Date ? retrievedAt : new Date(retrievedAt);
  if (Number.isNaN(d.getTime())) return true;
  return now.getTime() - d.getTime() > 1000 * 60 * 60 * 24 * 180;
}
