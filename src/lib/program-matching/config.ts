export const MATCHING_ENGINE_VERSION = "v1.8";

/** Min programmes per questionnaire direction in top-N when 2+ directions selected. */
export const MULTI_DIRECTION_MIN_SLOTS = 2;

export const TARGET_ACADEMIC_YEARS = [
  "2026/2027",
  "2027/2028",
] as const;

export type AcademicYear = (typeof TARGET_ACADEMIC_YEARS)[number];

export const DEFAULT_TARGET_ACADEMIC_YEAR: AcademicYear = "2027/2028";

/**
 * Fit priorities for Immigrome ops:
 * teaching language is primary; field/sphere next; geography secondary (ranking only);
 * certificates / admission tests / curricular gaps are prep-track (low weight).
 * Student may list several directions — matching any one is enough for field score.
 */
export const FIT_SCORE_WEIGHTS = {
  language: 34,
  field: 26,
  academicReadiness: 4,
  admissionTest: 4,
  geography: 16,
  budget: 8,
  scholarship: 5,
  studyMode: 3,
} as const;

/** Requirements the student can still complete before application. */
export const ASPIRATIONAL_REQUIREMENT_TYPES = [
  "LANGUAGE",
  "SAT",
  "TOLC",
  "ADMISSION_TEST",
  "INTERVIEW",
  "PORTFOLIO",
  "CURRICULAR_CREDITS",
  "SUBJECT_PREREQUISITE",
  "ACADEMIC_GRADE",
] as const;

/** Cap distinct field tags (questionnaire directions) per Generate.
 * @deprecated Soft hint only — discovery no longer silently truncates directions.
 */
export const UNIVERSITALY_MAX_DIRECTION_QUERIES = 3;

/**
 * Cap Universitaly query bases before × lingua (legacy synonym slice cap).
 * @deprecated Page budget (`UNIVERSITALY_MAX_PAGES`) is the only hard capacity limit.
 */
export const UNIVERSITALY_MAX_QUERY_SLICES = 8;

/** Curator match funnel: target ~15–20 programmes. */
export const MATCH_LIMIT_DEFAULT = 20;
export const MATCH_LIMIT_MIN = 15;

/** Light/deep enrich only top survivors after hard filter (before final top-20 slice). */
export const LIGHT_ENRICH_CANDIDATE_CAP = 28;

/** Shared program dossier reuse across students (days). */
export const PROGRAM_DOSSIER_TTL_DAYS = 30;

export const SOURCE_PRIORITY: Record<string, number> = {
  MANUAL_VERIFIED: 100,
  ADMISSION_CALL: 90,
  PROGRAMME_PAGE: 70,
  UNIVERSITY_GENERIC: 50,
  UNIVERSITALY: 40,
  CISIA: 30,
  SCHOLARSHIP_AUTHORITY: 30,
  MAECI: 20,
  OTHER: 10,
};

export const FETCH_RATE_LIMIT_MS = 800;
export const PARSER_VERSION = "call-v1.13";
export const SOURCE_STORAGE_ROOT = "./storage/sources";

/** Cineca Universitaly backend (used by universitaly.it UI). */
export const UNIVERSITALY_BACKEND_BASE =
  "https://universitaly-backend.cineca.it";
/** Shared page budget across all direction×lingua×classe queries. */
export const UNIVERSITALY_MAX_PAGES = 10;
/** Extended budget for thin-pool retry on primary classe queries only. */
export const UNIVERSITALY_MAX_PAGES_EXTENDED = 15;
export const UNIVERSITALY_PAGE_SIZE = 10;
export const UNIVERSITALY_SEARCH_CACHE_HOURS = 24;
/** Merge synonym searchText when MIUR pool is thinner than curator minimum. */
export const UNIVERSITALY_SYNONYM_FALLBACK_MIN_CANDIDATES = MATCH_LIMIT_MIN;
