import { normalizeMiurCode } from "@/lib/program-matching/miur-code";
import type { MiurCodeProvenance } from "@/lib/program-matching/miur-provenance";
import { QUESTIONNAIRE_DIRECTION_MIUR } from "@/lib/program-directions";
import {
  FIELD_TAG_SEARCH_SYNONYMS,
  DIRECTION_SEARCH_SYNONYMS,
  normalizeDirectionLabel,
  type FieldTag,
} from "@/lib/program-matching/taxonomy";

export type RelevanceEvidenceKind =
  | "exact_classe"
  | "secondary_classe"
  | "strong_tag"
  | "strong_direction_tag"
  | "synonym";

export type RelevanceEvidence = {
  kind: RelevanceEvidenceKind;
  matchedDirections: string[];
  matchedCodes: string[];
  detail?: string;
};

export type CandidateRelevanceInput = {
  degreeClass?: string | null;
  name?: string | null;
  fieldTags?: string[];
  selectedClasses: string[];
  selectedDirections: string[];
  /** When set, exact classe is primary vs secondary/shared. */
  miurCodes?: MiurCodeProvenance[];
};

/** Single tokens that must not count as a strong direction signal. */
const WEAK_SYNONYM_TOKENS = new Set([
  "computer",
  "computing",
  "data",
  "science",
  "engineering",
  "software",
  "digital",
  "management",
]);

function normalizeHaystack(parts: Array<string | null | undefined>): string {
  return parts
    .filter(Boolean)
    .map((p) => String(p).toLowerCase())
    .join(" ");
}

function isWeakSynonym(syn: string): boolean {
  const t = syn.trim().toLowerCase();
  if (!t) return true;
  if (WEAK_SYNONYM_TOKENS.has(t)) return true;
  return t.length < 6 && !t.includes(" ");
}

type DirectionHit = {
  kind: "strong_tag" | "synonym";
  matched: string[];
};

function directionHit(
  selectedDirections: string[],
  name: string | null | undefined,
  fieldTags: string[] | undefined
): DirectionHit | null {
  const hay = normalizeHaystack([name, ...(fieldTags ?? [])]);
  const tagSet = new Set(
    (fieldTags ?? []).map((t) => normalizeDirectionLabel(t))
  );
  const strong: string[] = [];
  const weak: string[] = [];

  for (const dir of selectedDirections) {
    const norm = normalizeDirectionLabel(dir);
    if (!norm) continue;
    if (hay.includes(norm) || tagSet.has(norm)) {
      strong.push(dir);
      continue;
    }
    const syns = [
      ...(DIRECTION_SEARCH_SYNONYMS[dir] ?? []),
      ...(FIELD_TAG_SEARCH_SYNONYMS[dir as FieldTag] ?? []),
    ];
    let classified: "strong_tag" | "synonym" | null = null;
    for (let i = 0; i < syns.length; i++) {
      const syn = syns[i]?.trim().toLowerCase();
      if (!syn || syn.length < 4 || !hay.includes(syn)) continue;
      if (isWeakSynonym(syn)) continue;
      classified = i === 0 || syn.includes(" ") ? "strong_tag" : "synonym";
      if (classified === "strong_tag") break;
    }
    if (classified === "strong_tag") strong.push(dir);
    else if (classified === "synonym") weak.push(dir);
  }

  if (strong.length > 0) return { kind: "strong_tag", matched: strong };
  if (weak.length > 0) return { kind: "synonym", matched: weak };
  return null;
}

/** Primary MIUR bucket key for cross-field title detection. */
function directionBucketKey(direction: string): string {
  const m = QUESTIONNAIRE_DIRECTION_MIUR[direction];
  if (!m) return direction;
  const codes = [
    ...m.bachelor,
    ...(m.singleCycle ?? []),
    ...m.master,
  ].map(normalizeMiurCode);
  return codes.sort()[0] ?? direction;
}

function directionsMatchedInHaystack(
  hay: string,
  fieldTags: string[] | undefined
): string[] {
  const tagSet = new Set(
    (fieldTags ?? []).map((t) => normalizeDirectionLabel(t))
  );
  const matched: string[] = [];
  for (const dir of Object.keys(QUESTIONNAIRE_DIRECTION_MIUR)) {
    const norm = normalizeDirectionLabel(dir);
    if (!norm) continue;
    if (hay.includes(norm) || tagSet.has(norm)) {
      matched.push(dir);
      continue;
    }
    const syns = [
      ...(DIRECTION_SEARCH_SYNONYMS[dir] ?? []),
      ...(FIELD_TAG_SEARCH_SYNONYMS[dir as FieldTag] ?? []),
    ];
    if (syns.some((syn) => {
      const s = syn.trim().toLowerCase();
      return s.length >= 4 && !isWeakSynonym(s) && hay.includes(s);
    })) {
      matched.push(dir);
    }
  }
  return matched;
}

/** Title mentions ≥2 questionnaire directions from different MIUR buckets. */
export function hasMultiDirectionTitleConflict(
  name: string | null | undefined,
  fieldTags: string[] | undefined
): boolean {
  const hay = normalizeHaystack([name, ...(fieldTags ?? [])]);
  const matched = directionsMatchedInHaystack(hay, fieldTags);
  const buckets = new Set(matched.map(directionBucketKey));
  return buckets.size >= 2;
}

function downgradeMultiDirectionEvidence(
  evidence: RelevanceEvidence
): RelevanceEvidence {
  if (evidence.kind === "strong_tag" || evidence.kind === "strong_direction_tag") {
    return {
      ...evidence,
      kind: "synonym",
      detail: evidence.detail
        ? `${evidence.detail}; multi-direction title`
        : "multi-direction title",
    };
  }
  return evidence;
}

export type GateRejectionHistogram = {
  city_excluded: number;
  no_classe_no_tag: number;
  passed: number;
};

export function emptyGateHistogram(): GateRejectionHistogram {
  return { city_excluded: 0, no_classe_no_tag: 0, passed: 0 };
}

/**
 * Soft-gate: keep corsi that match a selected MIUR classe, or carry a strong
 * direction signal in title/tags. Loose substring soup is not enough.
 * Shared/secondary classe still passes (rare EN corsi) with secondary_classe evidence.
 */
export function isCandidateRelevant(
  input: CandidateRelevanceInput
): { relevant: boolean; evidence: RelevanceEvidence | null } {
  const selectedNorm = new Set(
    input.selectedClasses.map(normalizeMiurCode).filter(Boolean)
  );
  const degreeNorm = input.degreeClass
    ? normalizeMiurCode(input.degreeClass)
    : "";

  if (degreeNorm && selectedNorm.has(degreeNorm)) {
    const roleMatches = (input.miurCodes ?? []).filter(
      (m) => normalizeMiurCode(m.code) === degreeNorm
    );
    const hasPrimary = roleMatches.some((m) => m.role === "primary");
    const hasSecondary = roleMatches.some((m) => m.role === "secondary");
    const strong = hasStrongDirectionEvidence(
      input.selectedDirections,
      input.name,
      input.fieldTags
    );
    const broadShared = BROAD_SHARED_CLASSI.has(degreeNorm) && !strong;
    const kind: RelevanceEvidenceKind = broadShared
      ? "secondary_classe"
      : !input.miurCodes || input.miurCodes.length === 0 || hasPrimary
        ? "exact_classe"
        : hasSecondary
          ? "secondary_classe"
          : "exact_classe";
    let evidence: RelevanceEvidence = {
      kind,
      matchedCodes: [degreeNorm],
      matchedDirections: [
        ...new Set(roleMatches.flatMap((m) => m.directions)),
      ],
      detail: degreeNorm,
    };
    if (hasMultiDirectionTitleConflict(input.name, input.fieldTags)) {
      evidence = downgradeMultiDirectionEvidence(evidence);
    }
    return {
      relevant: true,
      evidence,
    };
  }

  const tagHit = directionHit(
    input.selectedDirections,
    input.name,
    input.fieldTags
  );
  if (tagHit) {
    let evidence: RelevanceEvidence = {
      kind: tagHit.kind,
      matchedCodes: degreeNorm ? [degreeNorm] : [],
      matchedDirections: tagHit.matched,
      detail: tagHit.matched.join(", "),
    };
    if (hasMultiDirectionTitleConflict(input.name, input.fieldTags)) {
      evidence = downgradeMultiDirectionEvidence(evidence);
    }
    return {
      relevant: true,
      evidence,
    };
  }

  return { relevant: false, evidence: null };
}

export function hasStrongDirectionEvidence(
  selectedDirections: string[],
  name: string | null | undefined,
  fieldTags: string[] | undefined,
  forDirection?: string
): boolean {
  const hit = directionHit(selectedDirections, name, fieldTags);
  if (!hit || hit.kind !== "strong_tag") return false;
  if (!forDirection) return true;
  return hit.matched.some(
    (m) => normalizeDirectionLabel(m) === normalizeDirectionLabel(forDirection)
  );
}

/** Official classi shared across many questionnaire directions — rank, don't drop. */
export const BROAD_SHARED_CLASSI = new Set([
  "L-8",
  "L-9",
  "L-13",
  "L-1",
  "L-7",
]);
