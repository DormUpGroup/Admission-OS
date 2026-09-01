import { ASPIRATIONAL_REQUIREMENT_TYPES } from "@/lib/program-matching/config";
import type {
  EligibilityStatus,
  MatchingProfile,
  ProgramRiskFlag,
  RequirementEvaluation,
} from "@/lib/program-matching/types";
import {
  compareLanguageLevel,
  compareNumericRequirement,
  deadlineStatus,
  isUnknown,
} from "./compare";

const ASPIRATIONAL = new Set<string>(ASPIRATIONAL_REQUIREMENT_TYPES);

function isAspirationalRequirement(type: string) {
  return ASPIRATIONAL.has(type);
}

export type RequirementInput = {
  type: string;
  required: boolean;
  operator?: string | null;
  valueJson?: string | null;
  description?: string | null;
  hardExclusion?: boolean;
  sourceUrl?: string | null;
};

export type CycleInput = {
  applicationDeadline?: Date | string | null;
  applicantCategory?: string | null;
};

function parseValue(json: string | null | undefined): Record<string, unknown> {
  if (!json) return {};
  try {
    const v = JSON.parse(json);
    return v && typeof v === "object" ? v : {};
  } catch {
    return {};
  }
}

function languageFromProfile(profile: MatchingProfile, lang: string) {
  if (/english|en/i.test(lang)) return profile.englishLevel;
  if (/italian|it/i.test(lang)) return profile.italianLevel;
  return "UNKNOWN";
}

function cityEquals(a: string, b: string) {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

/** Structural degree levels that must align for a hard match. */
export function degreesCompatible(
  desired: string,
  programDegreeLevel: string
): boolean {
  if (desired === programDegreeLevel) return true;
  // Legacy catalog rows may store foundation pathways as OTHER.
  if (desired === "FOUNDATION" && programDegreeLevel === "OTHER") return true;
  return false;
}

export function evaluateRequirement(
  profile: MatchingProfile,
  req: RequirementInput
): RequirementEvaluation {
  const value = parseValue(req.valueJson);
  const description = req.description || req.type;
  const base = {
    type: req.type as RequirementEvaluation["type"],
    description,
    required: req.required,
    hardExclusion: false,
    sourceUrl: req.sourceUrl,
  };

  switch (req.type) {
    case "LANGUAGE": {
      const level = String(value.level ?? value.minLevel ?? "");
      const lang = String(value.language ?? "English");
      const status = compareLanguageLevel(languageFromProfile(profile, lang), level);
      return { ...base, status };
    }
    case "SAT": {
      const score = Number(value.score ?? value.min ?? value.minimum);
      const status = compareNumericRequirement(
        profile.sat,
        req.operator || ">=",
        Number.isFinite(score) ? score : null
      );
      return { ...base, status };
    }
    case "TOLC": {
      const test = String(value.test ?? "TOLC");
      const score = Number(value.score ?? value.min);
      const studentScore = profile.tolc[test];
      const status = compareNumericRequirement(
        typeof studentScore === "number" ? studentScore : "UNKNOWN",
        req.operator || ">=",
        Number.isFinite(score) ? score : null
      );
      return { ...base, status };
    }
    case "ADMISSION_TEST":
    case "INTERVIEW":
    case "PORTFOLIO":
    case "CURRICULAR_CREDITS":
    case "SUBJECT_PREREQUISITE":
    case "ACADEMIC_GRADE": {
      return { ...base, status: "UNKNOWN" };
    }
    case "EDUCATION": {
      const requiredLevel = String(value.degreeLevel ?? value.level ?? "");
      if (!requiredLevel) return { ...base, status: "UNKNOWN" };
      if (isUnknown(profile.desiredDegreeLevel)) return { ...base, status: "UNKNOWN" };
      if (degreesCompatible(String(profile.desiredDegreeLevel), requiredLevel)) {
        return { ...base, status: "MET" };
      }
      return { ...base, status: "NOT_MET" };
    }
    case "CITIZENSHIP":
    case "RESIDENCY_STATUS": {
      if (profile.applicantCategory === "UNKNOWN") return { ...base, status: "UNKNOWN" };
      const allowed = Array.isArray(value.categories)
        ? value.categories.map(String)
        : [];
      if (allowed.length === 0) return { ...base, status: "UNKNOWN" };
      return {
        ...base,
        status: allowed.includes(profile.applicantCategory) ? "MET" : "NOT_MET",
      };
    }
    default:
      return { ...base, status: "UNKNOWN" };
  }
}

/**
 * Hard exclusion only for:
 * - structural degree level (bachelor / master / foundation / single-cycle)
 * - teaching-language preference
 * - avoid-list geography (preferred cities are fit-only / secondary)
 *
 * Certificates, admission tests, deadlines, citizenship, etc. are prep /
 * preference signals and must not block the match.
 */
export function evaluateEligibility(input: {
  profile: MatchingProfile;
  programDegreeLevel: string;
  teachingLanguages: string[];
  campusCity?: string | null;
  region?: string | null;
  requirements: RequirementInput[];
  cycles: CycleInput[];
  dataConfidence: string;
  usingPreviousYear?: boolean;
}): {
  status: EligibilityStatus;
  evaluations: RequirementEvaluation[];
  risks: ProgramRiskFlag[];
} {
  const { profile } = input;
  const evaluations = input.requirements.map((r) => evaluateRequirement(profile, r));
  const risks: ProgramRiskFlag[] = [];

  if (profile.applicantCategory === "UNKNOWN") {
    risks.push("APPLICANT_CATEGORY_UNVERIFIED", "CURATOR_REVIEW_REQUIRED");
  }

  const degreeMismatch =
    !isUnknown(profile.desiredDegreeLevel) &&
    profile.desiredDegreeLevel !== "OTHER" &&
    !degreesCompatible(String(profile.desiredDegreeLevel), input.programDegreeLevel);

  if (degreeMismatch) {
    evaluations.unshift({
      type: "EDUCATION",
      description: `Programme is ${input.programDegreeLevel}, student seeks ${profile.desiredDegreeLevel}`,
      status: "NOT_MET",
      required: true,
      hardExclusion: true,
    });
  }

  const city = (input.campusCity ?? "").trim();
  const region = (input.region ?? "").trim();

  if (city && profile.excludedCities.some((c) => cityEquals(c, city))) {
    evaluations.push({
      type: "OTHER",
      description: `City ${city} is in student's avoid list`,
      status: "NOT_MET",
      required: true,
      hardExclusion: true,
    });
  } else if (
    region &&
    profile.excludedRegions.some((r) => cityEquals(r, region))
  ) {
    evaluations.push({
      type: "OTHER",
      description: `Region ${region} is excluded by student preferences`,
      status: "NOT_MET",
      required: true,
      hardExclusion: true,
    });
  }

  // Teaching-language preference is a hard structural filter.
  const langPref = profile.preferredTeachingLanguages.map((l) => l.toLowerCase());
  if (langPref.length > 0 && input.teachingLanguages.length > 0) {
    const overlap = input.teachingLanguages.some((l) =>
      langPref.some(
        (p) =>
          l.toLowerCase().includes(p.toLowerCase()) ||
          p.toLowerCase().includes(l.toLowerCase())
      )
    );
    if (!overlap) {
      evaluations.push({
        type: "LANGUAGE",
        description: `Teaching language ${input.teachingLanguages.join(", ")} vs preference ${profile.preferredTeachingLanguages.join(", ")}`,
        status: "NOT_MET",
        required: true,
        hardExclusion: true,
      });
    }
  }

  const hardNotMet = evaluations.filter((e) => e.hardExclusion && e.status === "NOT_MET");

  // Deadlines are informational only — never hard-exclude.
  if (!input.usingPreviousYear) {
    const relevantDeadlines = input.cycles
      .filter((c) => {
        if (!c.applicantCategory || c.applicantCategory === "ALL") return true;
        if (profile.applicantCategory === "UNKNOWN") return true;
        return c.applicantCategory === profile.applicantCategory;
      })
      .map((c) => deadlineStatus(c.applicationDeadline));

    if (relevantDeadlines.some((d) => d === "SOON")) {
      risks.push("DEADLINE_SOON");
    } else if (
      relevantDeadlines.filter((d) => d !== "UNKNOWN").length > 0 &&
      relevantDeadlines.filter((d) => d !== "UNKNOWN").every((d) => d === "PASSED")
    ) {
      risks.push("CURATOR_REVIEW_REQUIRED");
    }
  } else {
    risks.push("USING_PREVIOUS_YEAR_DATA", "CURATOR_REVIEW_REQUIRED");
  }

  if (hardNotMet.length > 0) {
    return { status: "NOT_ELIGIBLE", evaluations, risks };
  }

  // Non-structural requirement gaps never flip to NOT_ELIGIBLE.
  const blockingUnknown = evaluations.filter(
    (e) =>
      e.required &&
      e.status === "UNKNOWN" &&
      !isAspirationalRequirement(e.type) &&
      e.type !== "CITIZENSHIP" &&
      e.type !== "RESIDENCY_STATUS" &&
      e.type !== "OTHER"
  );

  if (
    blockingUnknown.length > 0 ||
    input.dataConfidence !== "HIGH" ||
    profile.applicantCategory === "UNKNOWN" ||
    input.usingPreviousYear
  ) {
    if (
      blockingUnknown.length === 0 &&
      profile.applicantCategory !== "UNKNOWN" &&
      !input.usingPreviousYear &&
      input.dataConfidence !== "HIGH"
    ) {
      return { status: "LIKELY_ELIGIBLE", evaluations, risks };
    }
    if (
      profile.applicantCategory === "UNKNOWN" ||
      input.usingPreviousYear ||
      blockingUnknown.length > 0
    ) {
      return { status: "NEEDS_REVIEW", evaluations, risks };
    }
    return { status: "LIKELY_ELIGIBLE", evaluations, risks };
  }

  return { status: "ELIGIBLE", evaluations, risks };
}
