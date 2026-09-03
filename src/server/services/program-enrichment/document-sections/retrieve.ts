import { prisma } from "@/lib/db";
import type { CriticalField } from "../schema";
import {
  DOSSIER_SECTION_TYPES,
  RETRIEVAL_CHAR_BUDGET,
  SHORTLIST_SECTION_TYPES,
  type RetrievalProvider,
  type RetrievalQuery,
  type RetrievalResult,
  type RetrievalSectionInput,
  type RetrievedSnippet,
  type SectionType,
} from "./types";

/**
 * Deterministic retrieval over official document sections.
 *
 * Embeddings / semantic search may be added later only as a second stage
 * after this hard metadata filter. Retrieved snippets help locate evidence;
 * they are never themselves a source of truth for facts or eligibility.
 */
export const FIELD_SECTION_TYPES: Record<CriticalField, SectionType[]> = {
  access: ["ADMISSION"],
  selection: ["ADMISSION", "EXAMS"],
  admissionExams: ["EXAMS", "ADMISSION"],
  languageRequirements: ["LANGUAGE"],
  seats: ["SEATS"],
  requiredDocuments: ["DOCUMENTS", "ADMISSION"],
  campuses: ["ADMISSION", "GENERAL"],
  deadlines: ["DEADLINES"],
  tuition: ["TUITION"],
};

const TYPE_PRIORITY: Record<SectionType, number> = {
  EXAMS: 8,
  ADMISSION: 7,
  LANGUAGE: 6,
  SEATS: 6,
  DOCUMENTS: 5,
  DEADLINES: 4,
  TUITION: 4,
  GENERAL: 1,
};

function normalizeYear(value: string | null | undefined): string | null {
  if (!value?.trim()) return null;
  const m = value.trim().match(/(20\d{2})\s*\/\s*(20\d{2}|\d{2})/);
  if (!m) return value.trim();
  const end = m[2].length === 2 ? `20${m[2]}` : m[2];
  return `${m[1]}/${end}`;
}

function preferredTypes(query: RetrievalQuery): Set<SectionType> {
  const modeTypes =
    query.mode === "shortlist" ? SHORTLIST_SECTION_TYPES : DOSSIER_SECTION_TYPES;
  const preferred = new Set<SectionType>(modeTypes);
  for (const field of query.neededFields ?? []) {
    for (const type of FIELD_SECTION_TYPES[field] ?? []) preferred.add(type);
  }
  return preferred;
}

function keywordScore(section: RetrievalSectionInput, query: RetrievalQuery): number {
  const hay = `${section.heading} ${section.text}`.toLowerCase();
  const terms = new Set<string>();
  for (const field of query.neededFields ?? []) {
    for (const type of FIELD_SECTION_TYPES[field] ?? []) {
      terms.add(type.toLowerCase());
    }
  }
  const extras = [
    "admission",
    "ammissione",
    "exam",
    "prova",
    "tolc",
    "sat",
    "imat",
    "language",
    "lingua",
    "seats",
    "posti",
    "documents",
    "documenti",
    "deadline",
    "scadenza",
    "tuition",
    "tasse",
  ];
  if (query.mode === "shortlist") {
    extras.push("enrol", "iscriv", "requisiti");
  }
  let hits = 0;
  for (const term of [...terms, ...extras]) {
    if (hay.includes(term)) hits += 1;
  }
  return Math.min(20, hits * 2);
}

function authorityScore(section: RetrievalSectionInput): number {
  const source = `${section.sourceType || ""} ${section.sourceAuthority || ""} ${section.metadata.sourceType || ""}`.toLowerCase();
  if (/universitaly|cineca|discovery/.test(source)) return 5;
  if (/admission_call|programme_page|bando/.test(source)) return 15;
  if (section.sourceAuthority) return 10;
  return 6;
}

function freshnessScore(retrievedAt: Date | null | undefined): number {
  if (!retrievedAt) return 2;
  const ageDays = (Date.now() - retrievedAt.getTime()) / 86_400_000;
  if (ageDays < 7) return 10;
  if (ageDays < 45) return 7;
  if (ageDays < 180) return 4;
  return 1;
}

function yearAccuracyScore(section: RetrievalSectionInput, queryYear: string): number {
  const query = normalizeYear(queryYear);
  const sectionYear = normalizeYear(
    section.metadata.academicYearHint || section.academicYear
  );
  if (!query) return 0;
  if (sectionYear && sectionYear === query) return 10;
  if (!sectionYear) return 2;
  return 0;
}

function passesMetadataFilter(
  section: RetrievalSectionInput,
  query: RetrievalQuery
): boolean {
  if (query.programId && section.programId && section.programId !== query.programId) {
    return false;
  }
  if (
    query.programAcademicYearId &&
    section.programAcademicYearId &&
    section.programAcademicYearId !== query.programAcademicYearId
  ) {
    return false;
  }
  if (query.sourceDocumentIds?.length) {
    if (!query.sourceDocumentIds.includes(section.sourceDocumentId)) return false;
  }

  const queryYear = normalizeYear(query.academicYear);
  const sectionYear = normalizeYear(
    section.metadata.academicYearHint || section.academicYear
  );
  if (queryYear && sectionYear && sectionYear !== queryYear) return false;

  const hints = section.metadata.applicantCategoryHints ?? [];
  const category = query.applicantCategory;
  if (hints.length > 0 && category && category !== "UNKNOWN") {
    const allowsAll = hints.includes("ALL");
    if (!allowsAll && !hints.includes(category)) return false;
  }
  return true;
}

function scoreSection(
  section: RetrievalSectionInput,
  query: RetrievalQuery,
  preferred: Set<SectionType>
): number {
  let score = TYPE_PRIORITY[section.sectionType] ?? 0;
  if (preferred.has(section.sectionType)) score += 50;
  if (section.sectionType === "GENERAL") score -= 20;
  score += keywordScore(section, query);
  score += freshnessScore(section.retrievedAt);
  score += authorityScore(section);
  score += yearAccuracyScore(section, query.academicYear);
  return score;
}

export function retrieveSections(
  sections: RetrievalSectionInput[],
  query: RetrievalQuery,
  budget = RETRIEVAL_CHAR_BUDGET
): RetrievalResult {
  const preferred = preferredTypes(query);
  const ranked = sections
    .filter((section) => passesMetadataFilter(section, query))
    .map((section) => ({
      section,
      score: scoreSection(section, query, preferred),
    }))
    .sort((a, b) => b.score - a.score || a.section.position - b.section.position);

  const snippets: RetrievedSnippet[] = [];
  let used = 0;
  let truncated = false;
  for (const row of ranked) {
    const size = row.section.text.length;
    if (used + size > budget) {
      truncated = true;
      continue;
    }
    used += size;
    snippets.push({
      sourceDocumentId: row.section.sourceDocumentId,
      sourceUrl: row.section.sourceUrl,
      heading: row.section.heading,
      sectionType: row.section.sectionType,
      text: row.section.text,
      score: row.score,
    });
  }
  if (ranked.length > 0 && snippets.length === 0 && ranked[0]) {
    snippets.push({
      sourceDocumentId: ranked[0].section.sourceDocumentId,
      sourceUrl: ranked[0].section.sourceUrl,
      heading: ranked[0].section.heading,
      sectionType: ranked[0].section.sectionType,
      text: ranked[0].section.text,
      score: ranked[0].score,
    });
    used = ranked[0].section.text.length;
    truncated = ranked.length > 1;
  }
  return { snippets, truncated, characterCount: used };
}

export function formatRetrievalContext(result: RetrievalResult): string {
  if (result.snippets.length === 0) {
    return "No relevant official sections were retrieved.";
  }
  return result.snippets
    .map((snippet) =>
      JSON.stringify({
        sourceDocumentId: snippet.sourceDocumentId,
        sourceUrl: snippet.sourceUrl,
        heading: snippet.heading,
        sectionType: snippet.sectionType,
        text: snippet.text,
      })
    )
    .join("\n");
}

export function sectionsFromExtracted(input: {
  sourceDocumentId: string;
  sourceUrl: string;
  programId?: string | null;
  programAcademicYearId?: string | null;
  academicYear?: string | null;
  sourceType?: string | null;
  sourceAuthority?: string | null;
  retrievedAt?: Date | null;
  sections: Array<{
    heading: string;
    sectionType: SectionType;
    position: number;
    text: string;
    metadata: RetrievalSectionInput["metadata"];
  }>;
}): RetrievalSectionInput[] {
  return input.sections.map((section) => ({
    sourceDocumentId: input.sourceDocumentId,
    sourceUrl: input.sourceUrl,
    programId: input.programId,
    programAcademicYearId: input.programAcademicYearId,
    academicYear: input.academicYear,
    sourceType: input.sourceType,
    sourceAuthority: input.sourceAuthority,
    retrievedAt: input.retrievedAt,
    heading: section.heading,
    sectionType: section.sectionType,
    position: section.position,
    text: section.text,
    metadata: section.metadata,
  }));
}

export class DeterministicSectionRetrievalProvider implements RetrievalProvider {
  async retrieve(query: RetrievalQuery): Promise<RetrievalResult> {
    const rows = await prisma.sourceDocumentSection.findMany({
      where: {
        sourceDocument: {
          ...(query.programId ? { programId: query.programId } : {}),
          ...(query.programAcademicYearId
            ? { programAcademicYearId: query.programAcademicYearId }
            : {}),
          ...(query.sourceDocumentIds?.length
            ? { id: { in: query.sourceDocumentIds } }
            : {}),
        },
      },
      include: {
        sourceDocument: {
          select: {
            id: true,
            url: true,
            programId: true,
            programAcademicYearId: true,
            academicYear: true,
            sourceType: true,
            sourceAuthority: true,
            retrievedAt: true,
          },
        },
      },
      orderBy: { position: "asc" },
    });

    const sections: RetrievalSectionInput[] = rows.map((row) => {
      let metadata: RetrievalSectionInput["metadata"] = {};
      try {
        metadata = row.metadataJson
          ? (JSON.parse(row.metadataJson) as RetrievalSectionInput["metadata"])
          : {};
      } catch {
        metadata = {};
      }
      return {
        sourceDocumentId: row.sourceDocumentId,
        sourceUrl: row.sourceDocument.url,
        programId: row.sourceDocument.programId,
        programAcademicYearId: row.sourceDocument.programAcademicYearId,
        academicYear: row.sourceDocument.academicYear,
        sourceType: row.sourceDocument.sourceType,
        sourceAuthority: row.sourceDocument.sourceAuthority,
        retrievedAt: row.sourceDocument.retrievedAt,
        heading: row.heading,
        sectionType: row.sectionType as SectionType,
        position: row.position,
        text: row.text,
        metadata,
      };
    });

    return retrieveSections(sections, query);
  }
}

export const defaultRetrievalProvider = new DeterministicSectionRetrievalProvider();
