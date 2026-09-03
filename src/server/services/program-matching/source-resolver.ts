import type { ApplicantCategory } from "@/lib/program-matching/types";
import {
  factScopeApplies,
  PROGRAMME_FACT_RESOLVER_VERSION,
} from "./programme-fact-contract";

export type FactCandidate = {
  id?: string;
  field?: string;
  normalizedValueJson?: string;
  sourceType: string;
  sourceDocumentId?: string | null;
  sourceUrl?: string | null;
  evidenceQuote?: string | null;
  academicYear?: string | null;
  publishedAt?: Date | string | null;
  retrievedAt?: Date | string | null;
  verificationStatus?: string | null;
  confidence?: string | null;
  superseded?: boolean;
  freshness?: string | null;
  applicantCategoryScope?: string | null;
  extractionMethod?: string | null;
  origin?: string | null;
  decisionStatus?: string | null;
  evidenceValidatedAt?: Date | string | null;
  dimensionKey?: string | null;
  resolverVersion?: string | null;
};

function ts(value: Date | string | null | undefined): number {
  if (!value) return 0;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? 0 : d.getTime();
}

function isManual(fact: FactCandidate): boolean {
  return (
    fact.origin === "MANUAL_VERIFIED" ||
    fact.sourceType === "MANUAL_VERIFIED" ||
    (fact.verificationStatus === "VERIFIED" &&
      fact.extractionMethod === "MANUAL")
  );
}

function inferredOrigin(fact: FactCandidate): string {
  if (isManual(fact)) return "MANUAL_VERIFIED";
  if (fact.origin) return fact.origin;
  if (fact.extractionMethod?.startsWith("OPENAI_")) return "AI";
  return "LEGACY_CANDIDATE";
}

function hasValidatedEvidence(fact: FactCandidate): boolean {
  return !!(
    fact.evidenceQuote?.trim() &&
    fact.sourceDocumentId &&
    fact.sourceUrl &&
    fact.evidenceValidatedAt &&
    fact.decisionStatus === "ELIGIBLE"
  );
}

/**
 * Strict decision tier. A negative value means the fact is not allowed to
 * influence matching or cards.
 */
export function factScore(
  fact: FactCandidate,
  targetAcademicYear?: string | null,
  options?: {
    applicantCategory?: ApplicantCategory | null;
  }
): number {
  if (fact.superseded) return -1;
  const manual = isManual(fact);
  if (targetAcademicYear && fact.academicYear !== targetAcademicYear) return -1;
  if (!manual && fact.freshness !== "CURRENT") return -1;
  if (!manual && !hasValidatedEvidence(fact)) return -1;
  if (fact.freshness === "CONFLICT" || fact.decisionStatus === "CONFLICT") return -1;

  const cat = options?.applicantCategory;
  const scope = fact.applicantCategoryScope;
  if (cat && !factScopeApplies(scope, cat)) return -1;

  if (manual) return 500;
  const origin = inferredOrigin(fact);
  const exactScope = !!cat && scope === cat;
  if (exactScope && origin === "AI") return 400;
  if (exactScope && origin === "OFFICIAL_FALLBACK") return 300;
  if (scope === "ALL" && (origin === "AI" || origin === "OFFICIAL_FALLBACK")) {
    return 200;
  }
  return -1;
}

export function resolveProgramFact<T extends FactCandidate>(
  facts: T[],
  targetAcademicYear?: string | null,
  options?: { applicantCategory?: ApplicantCategory | null }
): T | null {
  const ranked = facts
    .filter((f) => !f.superseded)
    .map((f) => ({ f, score: factScore(f, targetAcademicYear, options) }))
    .filter((entry) => entry.score >= 0)
    .sort(
      (a, b) =>
        b.score - a.score || ts(b.f.retrievedAt) - ts(a.f.retrievedAt)
    );
  const top = ranked[0];
  if (!top) return null;

  // Equal-priority contradictory values are unsafe until a curator resolves
  // the conflict. Newer retrieval time must not silently pick a winner.
  const peers = ranked.filter((entry) => entry.score === top.score);
  const values = new Set(
    peers.map((entry) => entry.f.normalizedValueJson).filter(Boolean)
  );
  if (values.size > 1) return null;
  return top.f;
}

export function resolveProgramFactCollection<T extends FactCandidate>(
  facts: T[],
  targetAcademicYear: string,
  applicantCategory: ApplicantCategory
): T[] {
  const groups = new Map<string, T[]>();
  for (const fact of facts) {
    const key = fact.dimensionKey || `${fact.field || "UNKNOWN"}:${fact.applicantCategoryScope || ""}`;
    groups.set(key, [...(groups.get(key) || []), fact]);
  }
  return [...groups.values()]
    .map((group) =>
      resolveProgramFact(group, targetAcademicYear, { applicantCategory })
    )
    .filter((fact): fact is T => !!fact);
}

export function detectStaleness(retrievedAt: Date | string | null, now = new Date()): boolean {
  if (!retrievedAt) return true;
  const d = retrievedAt instanceof Date ? retrievedAt : new Date(retrievedAt);
  if (Number.isNaN(d.getTime())) return true;
  return now.getTime() - d.getTime() > 1000 * 60 * 60 * 24 * 180;
}

export { PROGRAMME_FACT_RESOLVER_VERSION };
