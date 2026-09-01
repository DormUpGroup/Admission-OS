import {
  MATCH_LIMIT_DEFAULT,
  MATCH_LIMIT_MIN,
  MULTI_DIRECTION_MIN_SLOTS,
} from "@/lib/program-matching/config";
import { normalizeMiurCode } from "@/lib/program-matching/miur-code";
import type { DiscoveryMeta } from "./discovery-meta";
import { compareProgramMatchOrder } from "./match-rank";

export type ComposableMatch = {
  eligibilityStatus: string;
  fitScore: number;
  discoveryMeta: DiscoveryMeta;
  dataConfidence?: string;
  hasAdmissionCall?: boolean;
  usingPreviousYear?: boolean;
  degreeClass?: string | null;
};

function degreeInSelected(
  degreeClass: string | null | undefined,
  selectedClasses: string[]
): boolean {
  const dc = degreeClass ? normalizeMiurCode(degreeClass) : "";
  if (!dc) return false;
  return selectedClasses.some((c) => normalizeMiurCode(c) === dc);
}

export function isHighQualityEvidence(
  match: ComposableMatch,
  selectedClasses: string[]
): boolean {
  const kind = match.discoveryMeta.inclusion.kind;
  if (kind === "exact_classe") return true;
  if (kind === "secondary_classe" && degreeInSelected(match.degreeClass, selectedClasses)) {
    return true;
  }
  if (kind === "strong_tag" || kind === "strong_direction_tag") {
    return degreeInSelected(match.degreeClass, selectedClasses);
  }
  return false;
}

/** Directions from profile this match serves (for multi-direction balance). */
export function matchedProfileDirections(
  match: ComposableMatch,
  profileDirections: string[]
): string[] {
  const fromInclusion = match.discoveryMeta.inclusion.matchedDirections ?? [];
  const hit = fromInclusion.filter((d) => profileDirections.includes(d));
  if (hit.length > 0) return hit;

  const dc = match.degreeClass ? normalizeMiurCode(match.degreeClass) : "";
  if (!dc) return [];

  const dirs = new Set<string>();
  for (const mc of match.discoveryMeta.miurCodes) {
    if (normalizeMiurCode(mc.code) !== dc) continue;
    for (const d of mc.directions) {
      if (profileDirections.includes(d)) dirs.add(d);
    }
  }
  return [...dirs];
}

export type ShortlistCompositionMeta = {
  underfill: boolean;
  highQualityCount: number;
  excludedOffDirection: number;
  directionBalanceApplied: boolean;
};

/**
 * Drop only off-direction noise when the pool is rich enough.
 * Keeps secondary_classe / synonym when degreeClass is in the student's MIUR plan.
 */
export function applyShortlistComposition<T extends ComposableMatch>(
  sorted: T[],
  selectedClasses: string[],
  profileDirections: string[],
  limit: number = MATCH_LIMIT_DEFAULT
): { matches: T[]; meta: ShortlistCompositionMeta } {
  const highQuality = sorted.filter((m) =>
    isHighQualityEvidence(m, selectedClasses)
  );

  let pool = sorted;
  let excludedOffDirection = 0;

  if (highQuality.length >= MATCH_LIMIT_MIN) {
    const before = sorted.length;
    pool = sorted.filter((m) => {
      const kind = m.discoveryMeta.inclusion.kind;
      const inPlan = degreeInSelected(m.degreeClass, selectedClasses);

      if (inPlan && (kind === "exact_classe" || kind === "secondary_classe")) {
        return true;
      }

      if (kind === "synonym") return false;

      if (
        (kind === "strong_tag" ||
          kind === "strong_direction_tag" ||
          kind === "secondary_classe") &&
        !inPlan
      ) {
        return false;
      }

      return true;
    });
    excludedOffDirection = before - pool.length;
  }

  const balanced =
    profileDirections.length >= 2
      ? applyDirectionBalance(pool, profileDirections, limit)
      : pool.slice(0, limit);

  return {
    matches: balanced,
    meta: {
      underfill: balanced.length < MATCH_LIMIT_MIN,
      highQualityCount: highQuality.length,
      excludedOffDirection,
      directionBalanceApplied: profileDirections.length >= 2,
    },
  };
}

/**
 * Reserve minimum slots per questionnaire direction when multi-direction.
 */
export function applyDirectionBalance<T extends ComposableMatch>(
  sorted: T[],
  profileDirections: string[],
  limit: number = MATCH_LIMIT_DEFAULT
): T[] {
  if (profileDirections.length < 2) return sorted.slice(0, limit);

  const minSlots = MULTI_DIRECTION_MIN_SLOTS;
  const picked: T[] = [];
  const pickedSet = new Set<T>();

  for (const dir of profileDirections) {
    let count = 0;
    for (const m of sorted) {
      if (pickedSet.has(m)) continue;
      if (!matchedProfileDirections(m, profileDirections).includes(dir)) continue;
      picked.push(m);
      pickedSet.add(m);
      count += 1;
      if (count >= minSlots) break;
    }
  }

  for (const m of sorted) {
    if (picked.length >= limit) break;
    if (pickedSet.has(m)) continue;
    picked.push(m);
    pickedSet.add(m);
  }

  return picked.slice(0, limit);
}

export function shareByInclusionKind(
  matches: ComposableMatch[],
  kind: string
): number {
  if (matches.length === 0) return 0;
  const n = matches.filter((m) => m.discoveryMeta.inclusion.kind === kind).length;
  return Math.round((n / matches.length) * 100);
}

export function sortMatches<T extends ComposableMatch>(matches: T[]): T[] {
  return [...matches].sort((a, b) =>
    compareProgramMatchOrder(
      { ...a, degreeClass: a.degreeClass },
      { ...b, degreeClass: b.degreeClass }
    )
  );
}
