export type UnknownSentinel = "UNKNOWN";

export type EligibilityStatus =
  | "ELIGIBLE"
  | "LIKELY_ELIGIBLE"
  | "NEEDS_REVIEW"
  | "NOT_ELIGIBLE";

export type RequirementEvalStatus =
  | "MET"
  | "NOT_MET"
  | "UNKNOWN"
  | "NOT_APPLICABLE";

export type DataConfidence = "HIGH" | "MEDIUM" | "LOW";

export type CuratorMatchStatus =
  | "AUTO_MATCHED"
  | "NEEDS_REVIEW"
  | "APPROVED"
  | "REJECTED"
  | "SHORTLISTED"
  | "SELECTED";

export type ApplicantCategory =
  | "EU_CITIZEN"
  | "EU_EQUIVALENT"
  | "NON_EU_RESIDENT_ITALY"
  | "NON_EU_RESIDENT_ABROAD"
  | "UNKNOWN";

export type DegreeLevel =
  | "BACHELOR"
  | "MASTER"
  | "SINGLE_CYCLE"
  | "FOUNDATION"
  | "OTHER";

export type AdmissionRequirementType =
  | "EDUCATION"
  | "YEARS_OF_SCHOOLING"
  | "ACADEMIC_GRADE"
  | "SUBJECT_PREREQUISITE"
  | "LANGUAGE"
  | "ADMISSION_TEST"
  | "SAT"
  | "TOLC"
  | "INTERVIEW"
  | "PORTFOLIO"
  | "CURRICULAR_CREDITS"
  | "CITIZENSHIP"
  | "RESIDENCY_STATUS"
  | "DOCUMENT"
  | "OTHER";

export type ProgramRiskFlag =
  | "CALL_NOT_PUBLISHED"
  | "USING_PREVIOUS_YEAR_DATA"
  | "DEADLINE_SOON"
  | "MISSING_LANGUAGE_REQUIREMENT"
  | "MISSING_TEST_REQUIREMENT"
  | "NON_EU_QUOTA_UNKNOWN"
  | "TUITION_UNKNOWN"
  | "SCHOLARSHIP_RULES_NOT_VERIFIED"
  | "SOURCE_CONFLICT"
  | "SOURCE_STALE"
  | "LOW_EXTRACTION_CONFIDENCE"
  | "CURATOR_REVIEW_REQUIRED"
  | "APPLICANT_CATEGORY_UNVERIFIED";

export type MatchingProfile = {
  studentId: string;
  targetAcademicYear: string;
  citizenship: string | UnknownSentinel;
  secondCitizenship: string | UnknownSentinel;
  countryOfResidence: string | UnknownSentinel;
  applicantCategory: ApplicantCategory;
  visaRequired: boolean | UnknownSentinel;
  currentEducationLevel: string | UnknownSentinel;
  schoolCountry: string | UnknownSentinel;
  yearsOfSchooling: number | UnknownSentinel;
  diplomaType: string | UnknownSentinel;
  universityDegree: string | UnknownSentinel;
  degreeField: string | UnknownSentinel;
  gpa: number | UnknownSentinel;
  englishLevel: string | UnknownSentinel;
  englishCertificateRaw: string | UnknownSentinel;
  ielts: number | UnknownSentinel;
  toefl: number | UnknownSentinel;
  italianLevel: string | UnknownSentinel;
  italianCertificateRaw: string | UnknownSentinel;
  sat: number | UnknownSentinel;
  tolc: Record<string, number | UnknownSentinel>;
  desiredDegreeLevel: DegreeLevel | UnknownSentinel;
  fieldsOfInterest: string[];
  preferredTeachingLanguages: string[];
  preferredCities: string[];
  preferredRegions: string[];
  excludedCities: string[];
  excludedRegions: string[];
  mustBeInPreferredLocation: boolean;
  maxTuition: number | UnknownSentinel;
  needsScholarship: boolean | UnknownSentinel;
  dsuPriority: boolean | UnknownSentinel;
  studyModes: string[];
  missingFields: string[];
};

export type RequirementEvaluation = {
  type: AdmissionRequirementType;
  description: string;
  status: RequirementEvalStatus;
  required: boolean;
  hardExclusion: boolean;
  sourceUrl?: string | null;
};

export type FitScoreBreakdown = {
  field: number;
  academicReadiness: number;
  language: number;
  admissionTest: number;
  geography: number;
  budget: number;
  scholarship: number;
  studyMode: number;
  total: number;
};

export type MatchExplanation = {
  reasons: string[];
  risks: ProgramRiskFlag[];
  riskNotes: string[];
  missingInformation: string[];
};

export type ExtractedProgramPayload = {
  academicYear?: string;
  teachingLanguage?: string[];
  admissionRounds?: Array<{
    roundName: string;
    applicationDeadline?: string;
  }>;
  admissionRequirements?: Array<{
    type: AdmissionRequirementType;
    description: string;
    valueJson?: unknown;
  }>;
  languageRequirements?: unknown;
  tests?: unknown;
  tuition?: { minTuition?: number; maxTuition?: number; notes?: string };
  seats?: { total?: number; eu?: number; nonEu?: number };
  applicantCategories?: string[];
  confidence: DataConfidence;
  sourceQuote?: string;
  sourceUrl: string;
};
