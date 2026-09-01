import type { DiscoveryMeta } from "./discovery-meta";
import { normalizeMiurCode } from "@/lib/program-matching/miur-code";

const ELIGIBILITY_RANK: Record<string, number> = {
  ELIGIBLE: 0,
  LIKELY_ELIGIBLE: 1,
  NEEDS_REVIEW: 2,
  NOT_ELIGIBLE: 3,
};

const EVIDENCE_RANK: Record<string, number> = {
  exact_classe: 0,
  strong_tag: 1,
  strong_direction_tag: 1,
  shortlist: 1,
  secondary_classe: 2,
  synonym: 3,
};

const CONFIDENCE_RANK: Record<string, number> = {
  HIGH: 0,
  MEDIUM: 1,
  LOW: 2,
};

export type RankableMatch = {
  eligibilityStatus: string;
  fitScore: number;
  discoveryMeta?: DiscoveryMeta;
  dataConfidence?: string;
  hasAdmissionCall?: boolean;
  usingPreviousYear?: boolean;
  degreeClass?: string | null;
};

function miurPlanRoleRank(
  meta: DiscoveryMeta | undefined,
  degreeClass: string | null | undefined
): number {
  const dc = degreeClass ? normalizeMiurCode(degreeClass) : "";
  if (!dc || !meta?.miurCodes?.length) return 2;
  const entries = meta.miurCodes.filter(
    (m) => normalizeMiurCode(m.code) === dc
  );
  if (entries.some((e) => e.role === "primary")) return 0;
  if (entries.length > 0) return 1;
  return 2;
}

export function evidenceRank(kind: string | undefined): number {
  if (!kind) return 9;
  return EVIDENCE_RANK[kind] ?? 9;
}

/** Eligibility → evidence strength → fit → call freshness / confidence (v1.7). */
export function compareProgramMatchOrder(a: RankableMatch, b: RankableMatch): number {
  const er =
    (ELIGIBILITY_RANK[a.eligibilityStatus] ?? 9) -
    (ELIGIBILITY_RANK[b.eligibilityStatus] ?? 9);
  if (er !== 0) return er;

  const ev =
    evidenceRank(a.discoveryMeta?.inclusion.kind) -
    evidenceRank(b.discoveryMeta?.inclusion.kind);
  if (ev !== 0) return ev;

  const role =
    miurPlanRoleRank(a.discoveryMeta, a.degreeClass) -
    miurPlanRoleRank(b.discoveryMeta, b.degreeClass);
  if (role !== 0) return role;

  if (b.fitScore !== a.fitScore) return b.fitScore - a.fitScore;

  const call = Number(Boolean(b.hasAdmissionCall)) - Number(Boolean(a.hasAdmissionCall));
  if (call !== 0) return call;

  const conf =
    (CONFIDENCE_RANK[a.dataConfidence ?? ""] ?? 9) -
    (CONFIDENCE_RANK[b.dataConfidence ?? ""] ?? 9);
  if (conf !== 0) return conf;

  return Number(Boolean(a.usingPreviousYear)) - Number(Boolean(b.usingPreviousYear));
}
