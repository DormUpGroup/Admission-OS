import type { MatchingProfile } from "@/lib/program-matching/types";
import type { ApplicantCategory } from "@/lib/program-matching/types";

/** Minimal matching context for OpenAI — no PII. */
export type MinimalMatchingContext = {
  targetAcademicYear: string;
  degreeLevel: string | null;
  applicantCategory: ApplicantCategory;
  directions: string[];
  miurCodes: Array<{ code: string; role: string; sourceDirections: string[] }>;
  preferredTeachingLanguages: string[];
  preferredCities: string[];
  excludedCities: string[];
  maxTuition: number | null;
  program: {
    name: string;
    universityName: string;
    degreeClass: string | null;
    language: string | null;
    durationYears: number | null;
    campusCity: string | null;
    officialUrl: string | null;
  };
};

export function toMinimalMatchingContext(input: {
  profile: Pick<
    MatchingProfile,
    | "targetAcademicYear"
    | "desiredDegreeLevel"
    | "applicantCategory"
    | "fieldsOfInterest"
    | "preferredTeachingLanguages"
    | "preferredCities"
    | "excludedCities"
    | "maxTuition"
  >;
  miurCodes?: Array<{
    code: string;
    role: string;
    sourceDirections: string[];
  }>;
  program: MinimalMatchingContext["program"];
}): MinimalMatchingContext {
  const degree =
    input.profile.desiredDegreeLevel === "UNKNOWN"
      ? null
      : String(input.profile.desiredDegreeLevel);
  const maxTuition =
    typeof input.profile.maxTuition === "number"
      ? input.profile.maxTuition
      : null;
  return {
    targetAcademicYear: input.profile.targetAcademicYear,
    degreeLevel: degree,
    applicantCategory: input.profile.applicantCategory,
    directions: input.profile.fieldsOfInterest,
    miurCodes: input.miurCodes ?? [],
    preferredTeachingLanguages: input.profile.preferredTeachingLanguages,
    preferredCities: input.profile.preferredCities,
    excludedCities: input.profile.excludedCities,
    maxTuition,
    program: input.program,
  };
}

/** Map profile category to fact scope / tab selection. */
export function scopeForApplicantCategory(
  category: ApplicantCategory
): "ALL" | "EU_CITIZEN" | "NON_EU_RESIDENT_ABROAD" | "NON_EU_RESIDENT_ITALY" {
  if (category === "EU_CITIZEN" || category === "EU_EQUIVALENT") {
    return "EU_CITIZEN";
  }
  if (category === "NON_EU_RESIDENT_ABROAD") return "NON_EU_RESIDENT_ABROAD";
  if (category === "NON_EU_RESIDENT_ITALY") return "NON_EU_RESIDENT_ITALY";
  return "ALL";
}

export function factAppliesToCategory(
  factScope: string | null | undefined,
  category: ApplicantCategory
): boolean {
  if (!factScope || factScope === "ALL") return true;
  if (category === "UNKNOWN") return false;
  const needed = scopeForApplicantCategory(category);
  return factScope === needed;
}
