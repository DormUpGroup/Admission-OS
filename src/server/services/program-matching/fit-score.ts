import { FIT_SCORE_WEIGHTS } from "@/lib/program-matching/config";
import { normalizeMiurCode } from "@/lib/program-matching/miur-code";
import type { MiurCodeProvenance } from "@/lib/program-matching/miur-provenance";
import { tagsFromText } from "@/lib/program-matching/taxonomy";
import type {
  FitScoreBreakdown,
  MatchingProfile,
  RequirementEvaluation,
} from "@/lib/program-matching/types";
import {
  hasStrongDirectionEvidence,
  BROAD_SHARED_CLASSI,
  type RelevanceEvidence,
} from "@/server/services/program-matching/candidate-relevance";
import { compareLanguageLevel, isUnknown } from "./compare";

export type FitClasseProvenance = MiurCodeProvenance;

export type FitProgramInput = {
  name: string;
  field?: string | null;
  fieldTags: string[];
  campusCity?: string | null;
  region?: string | null;
  universityName?: string | null;
  teachingLanguages: string[];
  deliveryMode?: string | null;
  minTuition?: number | null;
  maxTuition?: number | null;
  englishRequired?: string | null;
  degreeClass?: string | null;
  /** Selected MIUR provenance from query plan (primary/secondary). */
  miurCodes?: MiurCodeProvenance[];
  /** Inclusion evidence from soft-gate — drives field multiplier (v1.7). */
  inclusionEvidence?: RelevanceEvidence | null;
};

function clamp(n: number, max: number) {
  return Math.max(0, Math.min(max, n));
}

function overlap(a: string[], b: string[]) {
  const bl = b.map((x) => x.toLowerCase());
  return a.filter((x) => bl.includes(x.toLowerCase())).length;
}

const SECONDARY_FIELD_FRACTION = 0.55;
const BROAD_SECONDARY_CAP_FRACTION = 0.45;
const STRONG_TAG_ALIGNED_FRACTION = 0.85;
const STRONG_TAG_MISALIGNED_FRACTION = 0.5;
const SYNONYM_FIELD_FRACTION = 0.4;

function degreeInSelected(
  degreeNorm: string,
  miur: MiurCodeProvenance[]
): boolean {
  if (!degreeNorm) return false;
  return miur.some((m) => normalizeMiurCode(m.code) === degreeNorm);
}

function fieldScoreFromEvidence(
  evidence: RelevanceEvidence,
  program: FitProgramInput,
  profile: MatchingProfile
): number {
  const maxField = FIT_SCORE_WEIGHTS.field;
  const degreeNorm = program.degreeClass
    ? normalizeMiurCode(program.degreeClass)
    : "";
  const miur = program.miurCodes ?? [];
  const inSelected = degreeInSelected(degreeNorm, miur);
  const strong = hasStrongDirectionEvidence(
    miur.flatMap((m) => m.directions).length
      ? [...new Set(miur.flatMap((m) => m.directions))]
      : profile.fieldsOfInterest,
    program.name,
    program.fieldTags
  );
  const broadShared = BROAD_SHARED_CLASSI.has(degreeNorm) && !strong;

  switch (evidence.kind) {
    case "exact_classe":
      if (broadShared) {
        return Math.round(maxField * BROAD_SECONDARY_CAP_FRACTION);
      }
      return maxField;
    case "secondary_classe":
      return Math.round(maxField * SECONDARY_FIELD_FRACTION);
    case "strong_tag":
    case "strong_direction_tag":
      return Math.round(
        maxField *
          (inSelected ? STRONG_TAG_ALIGNED_FRACTION : STRONG_TAG_MISALIGNED_FRACTION)
      );
    case "synonym":
      return Math.round(maxField * SYNONYM_FIELD_FRACTION);
    default:
      return 0;
  }
}

function scoreFieldComponent(
  profile: MatchingProfile,
  program: FitProgramInput
): number {
  const interest = profile.fieldsOfInterest.map((t) => t.toLowerCase());
  const programTags = [
    ...program.fieldTags,
    ...tagsFromText(program.field),
    ...tagsFromText(program.name),
  ].map((t) => t.toLowerCase());

  const maxField = FIT_SCORE_WEIGHTS.field;
  if (interest.length === 0) {
    return Math.round(maxField * 0.4);
  }

  if (program.inclusionEvidence) {
    return fieldScoreFromEvidence(program.inclusionEvidence, program, profile);
  }

  const degreeNorm = program.degreeClass
    ? normalizeMiurCode(program.degreeClass)
    : "";
  const miur = program.miurCodes ?? [];

  let best = 0;

  if (degreeNorm && miur.length > 0) {
    const matches = miur.filter(
      (m) => normalizeMiurCode(m.code) === degreeNorm
    );
    for (const m of matches) {
      const strong = hasStrongDirectionEvidence(
        m.directions.length ? m.directions : profile.fieldsOfInterest,
        program.name,
        program.fieldTags
      );
      const broad = BROAD_SHARED_CLASSI.has(degreeNorm) && !strong;
      if (m.role === "primary") {
        best = Math.max(
          best,
          broad ? Math.round(maxField * BROAD_SECONDARY_CAP_FRACTION) : maxField
        );
        continue;
      }
      if (strong) {
        best = Math.max(best, maxField);
      } else {
        best = Math.max(
          best,
          Math.round(maxField * BROAD_SECONDARY_CAP_FRACTION)
        );
      }
    }
  }

  const directionsForEvidence =
    miur.flatMap((m) => m.directions).length > 0
      ? [...new Set(miur.flatMap((m) => m.directions))]
      : profile.fieldsOfInterest;

  const strongTitle = hasStrongDirectionEvidence(
    directionsForEvidence,
    program.name,
    program.fieldTags
  );
  if (strongTitle) {
    const inSelected = degreeInSelected(degreeNorm, miur);
    best = Math.max(
      best,
      Math.round(
        maxField *
          (inSelected
            ? STRONG_TAG_ALIGNED_FRACTION
            : STRONG_TAG_MISALIGNED_FRACTION)
      )
    );
  }

  if (best === 0 && !degreeNorm) {
    const fieldHits = overlap(interest, programTags);
    if (fieldHits > 0) {
      best = Math.round(maxField * BROAD_SECONDARY_CAP_FRACTION);
    }
  }

  if (
    best === 0 &&
    degreeNorm &&
    miur.some(
      (m) =>
        normalizeMiurCode(m.code) === degreeNorm && m.role === "secondary"
    )
  ) {
    best = Math.round(maxField * SECONDARY_FIELD_FRACTION);
  }

  return best;
}

/** Normalize city name for geography matching (Milano / MILANO / Milan). */
function normalizeCityToken(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function cityTokensMatch(a: string, b: string): boolean {
  const na = normalizeCityToken(a);
  const nb = normalizeCityToken(b);
  if (na.length < 3 || nb.length < 3) return false;
  return na === nb || na.includes(nb) || nb.includes(na);
}

export function calculateFitScore(
  profile: MatchingProfile,
  program: FitProgramInput,
  evaluations: RequirementEvaluation[]
): FitScoreBreakdown {
  const field = scoreFieldComponent(profile, program);

  const academicReadiness = FIT_SCORE_WEIGHTS.academicReadiness;

  const langEval = evaluations.find((e) => e.type === "LANGUAGE");
  let language = Math.round(FIT_SCORE_WEIGHTS.language * 0.35);
  if (profile.preferredTeachingLanguages.length && program.teachingLanguages.length) {
    const hit = program.teachingLanguages.some((l) =>
      profile.preferredTeachingLanguages.some((p) =>
        l.toLowerCase().includes(p.toLowerCase())
      )
    );
    language = hit
      ? FIT_SCORE_WEIGHTS.language
      : Math.round(FIT_SCORE_WEIGHTS.language * 0.1);
  } else if (program.englishRequired) {
    const st = compareLanguageLevel(profile.englishLevel, program.englishRequired);
    if (st === "MET") language = FIT_SCORE_WEIGHTS.language;
  }
  if (langEval?.status === "MET" && !langEval.description.startsWith("Teaching language")) {
    language = Math.max(language, Math.round(FIT_SCORE_WEIGHTS.language * 0.85));
  }

  const testEval = evaluations.find(
    (e) => e.type === "SAT" || e.type === "TOLC" || e.type === "ADMISSION_TEST"
  );
  let admissionTest: number = FIT_SCORE_WEIGHTS.admissionTest;
  if (testEval?.status === "MET") {
    admissionTest = FIT_SCORE_WEIGHTS.admissionTest;
  } else if (testEval?.status === "NOT_MET") {
    admissionTest = Math.round(FIT_SCORE_WEIGHTS.admissionTest * 0.85);
  }

  let geography = 0;
  const city = program.campusCity;
  const region = program.region;
  const uniHay = `${program.universityName ?? ""}`.toLowerCase();
  const cityInUniversity = (c: string) => {
    const n = normalizeCityToken(c);
    if (n.length < 3 || n === "вся италия") return false;
    const uniNorm = normalizeCityToken(uniHay);
    return uniNorm.includes(n) || n.includes(uniNorm);
  };
  if (city && profile.excludedCities.some((c) => cityTokensMatch(c, city))) {
    geography = 0;
  } else if (
    (city &&
      profile.preferredCities.some((c) => cityTokensMatch(c, city))) ||
    profile.preferredCities.some(cityInUniversity)
  ) {
    geography = FIT_SCORE_WEIGHTS.geography;
  } else if (
    region &&
    profile.preferredRegions.some((r) => r.toLowerCase() === region.toLowerCase())
  ) {
    geography = Math.round(FIT_SCORE_WEIGHTS.geography * 0.8);
  } else if (profile.preferredCities.length === 0) {
    geography = Math.round(FIT_SCORE_WEIGHTS.geography * 0.6);
  } else if (!profile.mustBeInPreferredLocation) {
    geography = Math.round(FIT_SCORE_WEIGHTS.geography * 0.3);
  }

  let budget = Math.round(FIT_SCORE_WEIGHTS.budget * 0.5);
  if (!isUnknown(profile.maxTuition) && typeof profile.maxTuition === "number") {
    const tuition = program.minTuition ?? program.maxTuition;
    if (tuition == null) budget = Math.round(FIT_SCORE_WEIGHTS.budget * 0.3);
    else budget = tuition <= profile.maxTuition ? FIT_SCORE_WEIGHTS.budget : 0;
  }

  let scholarship = Math.round(FIT_SCORE_WEIGHTS.scholarship * 0.5);
  if (profile.needsScholarship === true) {
    scholarship = Math.round(FIT_SCORE_WEIGHTS.scholarship * 0.6);
  } else if (profile.needsScholarship === false) {
    scholarship = FIT_SCORE_WEIGHTS.scholarship;
  }

  const mode = program.deliveryMode || "inPerson";
  const studyMode = profile.studyModes.some((m) => m.toLowerCase() === mode.toLowerCase())
    ? FIT_SCORE_WEIGHTS.studyMode
    : Math.round(FIT_SCORE_WEIGHTS.studyMode * 0.4);

  const parts = {
    field,
    academicReadiness,
    language,
    admissionTest,
    geography,
    budget,
    scholarship,
    studyMode,
  };
  const total = Object.values(parts).reduce((a, b) => a + b, 0);
  return { ...parts, total: clamp(total, 100) };
}
