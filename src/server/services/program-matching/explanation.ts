import { ASPIRATIONAL_REQUIREMENT_TYPES } from "@/lib/program-matching/config";
import type {
  EligibilityStatus,
  MatchingProfile,
  MatchExplanation,
  ProgramRiskFlag,
  RequirementEvaluation,
} from "@/lib/program-matching/types";
import type { FitScoreBreakdown } from "@/lib/program-matching/types";

const ASPIRATIONAL = new Set<string>(ASPIRATIONAL_REQUIREMENT_TYPES);

/** Profile gaps that are normal prep work, not match blockers. */
const PREP_PROFILE_MISSING = [
  "English certificate / IELTS score",
  "SAT score",
  "English level",
];

export function buildExplanation(input: {
  profile: MatchingProfile;
  eligibility: EligibilityStatus;
  breakdown: FitScoreBreakdown;
  evaluations: RequirementEvaluation[];
  risks: ProgramRiskFlag[];
  teachingLanguages: string[];
  city?: string | null;
  region?: string | null;
  tuitionKnown: boolean;
  usingPreviousYear: boolean;
  callMissing: boolean;
}): MatchExplanation {
  const reasons: string[] = [];
  const riskNotes: string[] = [];
  const missingInformation = input.profile.missingFields.filter(
    (f) => !PREP_PROFILE_MISSING.includes(f)
  );
  const risks = [...input.risks];

  if (input.breakdown.field >= 15) {
    reasons.push(
      `Matches interest${input.profile.fieldsOfInterest.length > 1 ? "s" : ""}: ${
        input.profile.fieldsOfInterest.slice(0, 4).join(" + ") || "stated"
      }`
    );
  }
  if (
    input.breakdown.language >= 20 &&
    input.teachingLanguages.length > 0 &&
    input.profile.preferredTeachingLanguages.length > 0
  ) {
    reasons.push(
      `Teaching language matches preference (${input.teachingLanguages.join(", ")})`
    );
  } else if (input.teachingLanguages.some((l) => /english/i.test(l))) {
    reasons.push("Programme taught in English");
  }
  if (input.city && input.profile.preferredCities.some((c) => c.toLowerCase() === input.city!.toLowerCase())) {
    reasons.push(`Preferred city: ${input.city}`);
  } else if (
    input.region &&
    input.profile.preferredRegions.some((r) => r.toLowerCase() === input.region!.toLowerCase())
  ) {
    reasons.push(`Preferred region: ${input.region}`);
  }
  if (input.breakdown.budget >= 7 && input.tuitionKnown) {
    reasons.push("Tuition appears within stated budget");
  }
  for (const e of input.evaluations) {
    if (e.status === "MET") reasons.push(`${e.description} satisfied`);
    // Prep-track requirements are collected during preparation — not "missing info".
    if (e.status === "UNKNOWN" && e.required && !ASPIRATIONAL.has(e.type)) {
      missingInformation.push(e.description);
    }
  }

  if (input.usingPreviousYear) {
    risks.push("USING_PREVIOUS_YEAR_DATA");
    riskNotes.push(
      `${input.profile.targetAcademicYear} requirements not published yet. Information is based on a previous year and MUST be reverified.`
    );
  }
  if (input.callMissing) {
    risks.push("CALL_NOT_PUBLISHED");
    riskNotes.push("Admission call not yet published.");
  }
  if (!input.tuitionKnown) risks.push("TUITION_UNKNOWN");
  if (input.profile.needsScholarship === true) {
    risks.push("SCHOLARSHIP_RULES_NOT_VERIFIED");
  }
  if (input.profile.applicantCategory === "UNKNOWN") {
    riskNotes.push("Applicant category requires verification.");
  }

  const uniqueReasons = [...new Set(reasons)].slice(0, 8);
  const uniqueMissing = [...new Set(missingInformation)];
  const uniqueRisks = [...new Set(risks)];

  return {
    reasons: uniqueReasons,
    risks: uniqueRisks,
    riskNotes: [...new Set(riskNotes)],
    missingInformation: uniqueMissing,
  };
}
