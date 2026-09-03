import type { ApplicantCategory } from "@/lib/program-matching/types";
import type { CriticalField } from "../schema";

export const SECTION_TYPES = [
  "ADMISSION",
  "EXAMS",
  "LANGUAGE",
  "SEATS",
  "DEADLINES",
  "TUITION",
  "DOCUMENTS",
  "GENERAL",
] as const;

export type SectionType = (typeof SECTION_TYPES)[number];

export type HtmlKind =
  | "heading"
  | "tab"
  | "accordion"
  | "table"
  | "semantic"
  | "plain"
  | "cue";

export type SectionMetadata = {
  applicantCategoryHints?: string[];
  academicYearHint?: string | null;
  sourceAuthority?: string | null;
  sourceType?: string | null;
  parentHeading?: string | null;
  splitIndex?: number;
  htmlKind?: HtmlKind;
};

export type ExtractedSection = {
  heading: string;
  sectionType: SectionType;
  position: number;
  text: string;
  contentHash: string;
  metadata: SectionMetadata;
};

export type RetrievalMode = "shortlist" | "dossier";

export type RetrievalQuery = {
  programId?: string | null;
  programAcademicYearId?: string | null;
  academicYear: string;
  applicantCategory: ApplicantCategory | string;
  mode: RetrievalMode;
  sourceDocumentIds?: string[];
  neededFields?: CriticalField[];
};

export type RetrievedSnippet = {
  sourceDocumentId: string;
  sourceUrl: string;
  heading: string;
  sectionType: SectionType;
  text: string;
  score: number;
};

export type RetrievalResult = {
  snippets: RetrievedSnippet[];
  truncated: boolean;
  characterCount: number;
};

export type RetrievalSectionInput = {
  sourceDocumentId: string;
  sourceUrl: string;
  programId?: string | null;
  programAcademicYearId?: string | null;
  academicYear?: string | null;
  sourceType?: string | null;
  sourceAuthority?: string | null;
  retrievedAt?: Date | null;
  heading: string;
  sectionType: SectionType;
  position: number;
  text: string;
  metadata: SectionMetadata;
};

/**
 * Retrieval abstraction.
 *
 * Embeddings / semantic search may be added later only as a second stage
 * after hard metadata filtering (program, academic year, applicant category,
 * source documents). They are never a source of truth for facts, matching,
 * or eligibility.
 */
export interface RetrievalProvider {
  retrieve(query: RetrievalQuery): Promise<RetrievalResult>;
}

export const MAX_SECTION_CHARS = 4_000;
export const SECTION_OVERLAP_CHARS = 250;
export const RETRIEVAL_CHAR_BUDGET = 12_000;

export const SHORTLIST_SECTION_TYPES: readonly SectionType[] = [
  "ADMISSION",
  "EXAMS",
  "LANGUAGE",
  "SEATS",
  "DOCUMENTS",
];

export const DOSSIER_SECTION_TYPES: readonly SectionType[] = [
  ...SHORTLIST_SECTION_TYPES,
  "DEADLINES",
  "TUITION",
];
