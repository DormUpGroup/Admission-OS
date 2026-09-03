import { prisma } from "@/lib/db";
import { admissionCallAdapter } from "@/server/services/program-ingestion/adapters/admission-call";
import { universityWebsiteAdapter } from "@/server/services/program-ingestion/adapters/university-website";
import {
  discoverBandoUrls,
  isClearlyNonAdmissionNotice,
  isRejectedEnrichmentCandidateUrl,
  pickFollowLinks,
  admissionSiblingUrls,
} from "@/server/services/program-ingestion/bando-url-discover";
import {
  extractHtmlMainText,
  fieldCoverageScore,
  parseCallText,
  type CallTextParse,
} from "@/server/services/program-ingestion/call-text-parse";
import { upsertSourceDocument } from "@/server/services/program-ingestion/snapshot";
import { formatExamAlternatives } from "@/lib/program-matching/examiner-links";
import {
  DEFAULT_TARGET_ACADEMIC_YEAR,
  PARSER_VERSION,
  SOURCE_PRIORITY,
} from "@/lib/program-matching/config";
import type {
  EnrichmentDocumentTrace,
  EnrichmentTrace,
} from "@/server/services/program-ingestion/field-reason-classifier";
import { inferPublicPrivateFromUniversityName } from "@/server/services/program-ingestion/infer-public-private";
import {
  inferAdmissionRegime,
  mergeAdmissionRegime,
  type AdmissionRegime,
} from "@/server/services/program-ingestion/admission-regime";
import {
  factDimensionKey,
  PROGRAMME_FACT_RESOLVER_VERSION,
} from "@/server/services/program-matching/programme-fact-contract";
import { isProgramEnrichmentEnabled } from "@/server/services/program-enrichment/config";
import { validateEvidenceQuote } from "@/server/services/program-enrichment/quote-validator";

const ENRICH_TIMEOUT_MS = 18_000;
const FETCH_RETRY_DELAY_MS = 800;
const FETCH_RETRY_DELAY_2_MS = 1600;

async function sleep(ms: number) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchWithTimeout(
  url: string,
  preferAdmissionCall = false
): Promise<{
  ok: boolean;
  body: string;
  contentType: string;
}> {
  const attempt = async () => {
    try {
      const fetchFn = preferAdmissionCall
        ? admissionCallAdapter.fetch
        : universityWebsiteAdapter.fetch;
      if (!fetchFn) {
        return { ok: false, body: "FETCH_ERROR no_adapter", contentType: "text/plain" };
      }
      const fetched = await Promise.race([
        fetchFn(url),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error("enrich_timeout")), ENRICH_TIMEOUT_MS)
        ),
      ]);
      return {
        ok:
          !fetched.body.startsWith("FETCH_FAILED") &&
          !fetched.body.startsWith("FETCH_ERROR") &&
          !fetched.body.startsWith("PDF_EXTRACTION_"),
        body: fetched.body,
        contentType: fetched.contentType,
      };
    } catch (e) {
      return {
        ok: false,
        body: `FETCH_ERROR ${e instanceof Error ? e.message : "unknown"}`,
        contentType: "text/plain",
      };
    }
  };

  const first = await attempt();
  if (first.ok || first.body.startsWith("PDF_EXTRACTION_")) return first;
  await sleep(FETCH_RETRY_DELAY_MS);
  const second = await attempt();
  if (second.ok || second.body.startsWith("PDF_EXTRACTION_")) return second;
  await sleep(FETCH_RETRY_DELAY_2_MS);
  return attempt();
}

function parseLooseDate(raw: string): Date | null {
  const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (iso) {
    const d = new Date(`${iso[1]}-${iso[2]}-${iso[3]}T12:00:00Z`);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  const dmy = raw.match(/^(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{4})$/);
  if (dmy) {
    const d = new Date(
      `${dmy[3]}-${dmy[2].padStart(2, "0")}-${dmy[1].padStart(2, "0")}T12:00:00Z`
    );
    return Number.isNaN(d.getTime()) ? null : d;
  }
  const months: Record<string, string> = {
    january: "01",
    february: "02",
    march: "03",
    april: "04",
    may: "05",
    june: "06",
    july: "07",
    august: "08",
    september: "09",
    october: "10",
    november: "11",
    december: "12",
    gennaio: "01",
    febbraio: "02",
    marzo: "03",
    aprile: "04",
    maggio: "05",
    giugno: "06",
    luglio: "07",
    agosto: "08",
    settembre: "09",
    ottobre: "10",
    novembre: "11",
    dicembre: "12",
  };
  const named = raw.match(
    /^(\d{1,2})\s+([A-Za-zàèéìòù]+)\s+(20\d{2})$/i
  );
  if (named) {
    const mm = months[named[2].toLowerCase()];
    if (mm) {
      const d = new Date(
        `${named[3]}-${mm}-${named[1].padStart(2, "0")}T12:00:00Z`
      );
      return Number.isNaN(d.getTime()) ? null : d;
    }
  }
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function sourceRank(sourceType: string): number {
  return SOURCE_PRIORITY[sourceType] ?? 0;
}

async function upsertFact(input: {
  programId: string;
  programAcademicYearId: string;
  field: string;
  value: unknown;
  sourceDocumentId?: string;
  sourceUrl?: string;
  academicYear: string;
  sourceType: string;
  extractionMethod: string;
  confidence?: string;
  rawValue?: string;
  evidenceQuote?: string;
  applicantCategoryScope?: string;
  dimensionKey?: string;
  evidenceValidated?: boolean;
}) {
  const existing = await prisma.programFact.findFirst({
    where: {
      programId: input.programId,
      programAcademicYearId: input.programAcademicYearId,
      field: input.field,
      superseded: false,
      applicantCategoryScope: input.applicantCategoryScope ?? null,
      dimensionKey: input.dimensionKey ?? null,
    },
  });
  const data = {
    normalizedValueJson: JSON.stringify(input.value),
    rawValue: input.rawValue,
    sourceDocumentId: input.sourceDocumentId,
    sourceUrl: input.sourceUrl,
    sourceType: input.sourceType,
    confidence: input.confidence ?? "MEDIUM",
    retrievedAt: new Date(),
    extractionMethod: input.extractionMethod,
    academicYear: input.academicYear,
    evidenceQuote: input.evidenceQuote ?? null,
    applicantCategoryScope: input.applicantCategoryScope ?? null,
    freshness: input.evidenceValidated ? "CURRENT" : "UNKNOWN",
    origin: "OFFICIAL_FALLBACK",
    dimensionKey: input.dimensionKey ?? null,
    decisionStatus: input.evidenceValidated
      ? "ELIGIBLE"
      : "LEGACY_CANDIDATE",
    evidenceValidatedAt: input.evidenceValidated ? new Date() : null,
    resolverVersion: PROGRAMME_FACT_RESOLVER_VERSION,
  };
  if (existing) {
    if (existing.sourceType === "MANUAL_VERIFIED") {
      return existing;
    }
    // Never downgrade ADMISSION_CALL with weaker PROGRAMME_PAGE
    if (
      sourceRank(existing.sourceType) > sourceRank(input.sourceType)
    ) {
      return existing;
    }
    return prisma.programFact.update({ where: { id: existing.id }, data });
  }
  return prisma.programFact.create({
    data: {
      programId: input.programId,
      programAcademicYearId: input.programAcademicYearId,
      field: input.field,
      verificationStatus: "UNVERIFIED",
      ...data,
    },
  });
}

function extractionQualityLabel(quality: CallTextParse["quality"]): string {
  if (quality === "OK") return "OK";
  if (quality === "LOW") return "LOW_EXTRACTION_QUALITY";
  return "NEEDS_REVIEW";
}

type ParsedDocument = {
  parsed: CallTextParse;
  url: string;
  body: string;
  sourceType: "ADMISSION_CALL" | "PROGRAMME_PAGE";
  method: string;
};

async function persistScopedQuotaFacts(
  pay: {
    id: string;
    programId: string;
    academicYear: string;
    program: { universityId: string; name: string };
  },
  documents: ParsedDocument[]
) {
  for (const document of documents) {
    const plainText = /html/i.test(document.method)
      ? extractHtmlMainText(document.body)
      : document.body;
    const snapshot = await upsertSourceDocument({
      sourceType: document.sourceType,
      sourceAuthority: pay.program.name,
      url: document.url,
      academicYear: pay.academicYear,
      universityId: pay.program.universityId,
      programId: pay.programId,
      programAcademicYearId: pay.id,
      contentType: /pdf/i.test(document.method) ? "pdf" : "html",
      body: plainText.slice(0, 100_000),
      status: "FETCHED",
      extractionQuality: extractionQualityLabel(document.parsed.quality),
    });
    for (const row of document.parsed.quotaRows) {
      const mapped = row.category !== "UNMAPPED";
      const scope = mapped ? row.category : undefined;
      await upsertFact({
        programId: pay.programId,
        programAcademicYearId: pay.id,
        field: "SEATS",
        value: {
          places: row.places,
          category: row.category,
          originalGroup: row.originalGroup,
          categoryCode: row.categoryCode ?? null,
        },
        sourceDocumentId: snapshot.document.id,
        sourceUrl: document.url,
        academicYear: pay.academicYear,
        sourceType: document.sourceType,
        extractionMethod: `FALLBACK_${document.method}`,
        confidence: row.confidence,
        rawValue: row.originalGroup,
        evidenceQuote: row.snippet,
        applicantCategoryScope: scope,
        dimensionKey: factDimensionKey({
          field: "SEATS",
          scope: scope || "UNMAPPED",
          categoryCode: row.categoryCode,
          discriminator: row.originalGroup,
        }),
        evidenceValidated:
          mapped &&
          validateEvidenceQuote(row.snippet, plainText).accepted,
      });
    }

    const fallbackFacts: Array<{
      field: string;
      value: unknown;
      quote?: string;
      discriminator: string;
      confidence?: string;
    }> = [];
    const tuitionQuote =
      document.parsed.tuitionFixed?.snippet ||
      document.parsed.tuitionMax?.snippet ||
      document.parsed.tuitionMin?.snippet;
    if (tuitionQuote) {
      fallbackFacts.push({
        field: "TUITION",
        value: {
          min: document.parsed.tuitionMin?.value ?? null,
          max: document.parsed.tuitionMax?.value ?? null,
          fixed: document.parsed.tuitionFixed?.value ?? null,
          incomeBased: document.parsed.incomeBased,
        },
        quote: tuitionQuote,
        discriminator: "annual",
        confidence:
          document.parsed.tuitionFixed?.confidence ||
          document.parsed.tuitionMax?.confidence ||
          document.parsed.tuitionMin?.confidence,
      });
    }
    document.parsed.deadlines.forEach((deadline, index) => {
      fallbackFacts.push({
        field: "APPLICATION_DEADLINE",
        value: { date: deadline.value, roundName: `Round ${index + 1}` },
        quote: deadline.snippet,
        discriminator: `round-${index + 1}`,
        confidence: deadline.confidence,
      });
    });
    if (
      document.parsed.accessMode.value !== "UNKNOWN" &&
      document.parsed.accessMode.snippet
    ) {
      fallbackFacts.push({
        field: "ACCESS_TYPE",
        value: { mode: document.parsed.accessMode.value },
        quote: document.parsed.accessMode.snippet,
        discriminator: "access",
        confidence: document.parsed.accessMode.confidence,
      });
    }
    if (document.parsed.languageLevel?.snippet) {
      fallbackFacts.push({
        field: "LANGUAGE_REQUIREMENT",
        value: {
          language: document.parsed.languages[0] || "English",
          level: document.parsed.languageLevel.value,
        },
        quote: document.parsed.languageLevel.snippet,
        discriminator: document.parsed.languages[0] || "English",
        confidence: document.parsed.languageLevel.confidence,
      });
    }

    for (const fact of fallbackFacts) {
      if (!fact.quote) continue;
      const evidenceValidated = validateEvidenceQuote(
        fact.quote,
        plainText
      ).accepted;
      const mentionsApplicantGroup =
        /\b(?:non[\s-]?(?:eu|ue)|extra[\s-]?ue|eu\s+citizens?|international\s+students?|residenti|residing)\b/i.test(
          fact.quote
        );
      const scope =
        mentionsApplicantGroup &&
        (fact.field === "APPLICATION_DEADLINE" || fact.field === "TUITION")
          ? undefined
          : "ALL";
      await upsertFact({
        programId: pay.programId,
        programAcademicYearId: pay.id,
        field: fact.field,
        value: fact.value,
        sourceDocumentId: snapshot.document.id,
        sourceUrl: document.url,
        academicYear: pay.academicYear,
        sourceType: document.sourceType,
        extractionMethod: `FALLBACK_${document.method}`,
        confidence: fact.confidence,
        rawValue: fact.quote,
        evidenceQuote: fact.quote,
        applicantCategoryScope: scope,
        dimensionKey: factDimensionKey({
          field: fact.field,
          scope: scope || "UNMAPPED",
          discriminator: fact.discriminator,
        }),
        evidenceValidated: evidenceValidated && !!scope,
      });
    }
  }
}

/**
 * A call is usually authoritative for access, seats and deadlines; a linked
 * tasse/requisiti page can be the only source for fees or language. Merge
 * fields instead of treating one high-coverage document as the whole dossier.
 */
function mergeParsedDocuments(documents: ParsedDocument[]): CallTextParse | null {
  if (documents.length === 0) return null;
  const ordered = [...documents].sort((a, b) => {
    const source = sourceRank(b.sourceType) - sourceRank(a.sourceType);
    if (source !== 0) return source;
    return fieldCoverageScore(b.parsed) - fieldCoverageScore(a.parsed);
  });
  const top = ordered[0].parsed;
  const first = <T,>(get: (parsed: CallTextParse) => T, present: (v: T) => boolean): T => {
    for (const document of ordered) {
      const found = get(document.parsed);
      if (present(found)) return found;
    }
    return get(top);
  };
  const bestAccess = first((p) => p.accessMode, (v) => v.value !== "UNKNOWN");
  const bestExams = first(
    (p) => ({ exams: p.exams, alternatives: p.examAlternatives, confidence: p.examsConfidence, gate: p.admissionGate, evaluation: p.evaluationOnly }),
    (v) => v.exams.length > 0 || v.alternatives.length > 0
  );
  return {
    ...top,
    languages: first((p) => p.languages, (v) => v.length > 0),
    languageLevel: first((p) => p.languageLevel, (v) => v != null),
    tuitionMin: first((p) => p.tuitionMin, (v) => v != null),
    tuitionMax: first((p) => p.tuitionMax, (v) => v != null),
    tuitionFixed: first((p) => p.tuitionFixed, (v) => v != null),
    tuitionScope: first((p) => p.tuitionScope, (v) => v != null),
    deadlines: first((p) => p.deadlines, (v) => v.length > 0),
    accessMode: bestAccess,
    euSeats: first((p) => p.euSeats, (v) => v != null),
    nonEuSeats: first((p) => p.nonEuSeats, (v) => v != null),
    totalSeats: first((p) => p.totalSeats, (v) => v != null),
    quotaRows: ordered.flatMap((document) => document.parsed.quotaRows),
    exams: bestExams.exams,
    examAlternatives: bestExams.alternatives,
    examsConfidence: bestExams.confidence,
    admissionGate: bestExams.gate,
    evaluationOnly: bestExams.evaluation,
  };
}

function regimeFromDocument(document: ParsedDocument): AdmissionRegime {
  const regime = document.parsed.admissionRegime;
  const source = <T,>(field: AdmissionRegime[keyof AdmissionRegime] & { value: T }) => ({
    ...field,
    sourceUrl: document.url,
    sourceType: document.sourceType,
  });
  return {
    access: source(regime.access),
    selection: source(regime.selection),
    admissionExams: source(regime.admissionExams),
    languageRequirement: source(regime.languageRequirement),
    seats: source(regime.seats),
    ownership: source(regime.ownership),
  };
}

async function applyParsedFacts(input: {
  pay: {
    id: string;
    programId: string;
    academicYear: string;
    accessMode: string;
    dataConfidence: string;
    program: {
      id: string;
      name: string;
      language: string | null;
      universityId: string;
      university: { publicPrivate: string | null; name: string };
    };
    cycles: Array<{
      id: string;
      applicationDeadline: Date | null;
      euSeats: number | null;
      nonEuSeats: number | null;
      totalSeats: number | null;
    }>;
    requirements: Array<{ id: string; type: string }>;
    tuition: { id: string } | null;
  };
  parsed: CallTextParse;
  sourceDocumentId: string;
  sourceUrl: string;
  sourceType: "ADMISSION_CALL" | "PROGRAMME_PAGE";
  extractionMethod: string;
  regime?: AdmissionRegime;
  /** Fee and deadline work is deferred until a programme is shortlisted. */
  deferAdministrativeFields?: boolean;
}): Promise<{ accessMode: string; hadSignal: boolean }> {
  const { pay, parsed, sourceDocumentId, sourceUrl, sourceType, extractionMethod } =
    input;
  let hadSignal = false;
  const writeLegacyProjection = !isProgramEnrichmentEnabled();
  const ownership = inferPublicPrivateFromUniversityName(pay.program.university.name);

  let catalogueAccess: "OPEN" | "CLOSED" | "UNKNOWN" =
    pay.accessMode === "OPEN" || pay.accessMode === "CLOSED"
      ? pay.accessMode
      : "UNKNOWN";
  if (catalogueAccess === "UNKNOWN") {
    const accessFact = await prisma.programFact.findFirst({
      where: {
        programAcademicYearId: pay.id,
        field: "ACCESS_TYPE",
        superseded: false,
      },
      orderBy: { retrievedAt: "desc" },
      select: { normalizedValueJson: true },
    });
    if (accessFact?.normalizedValueJson) {
      try {
        const v = JSON.parse(accessFact.normalizedValueJson) as {
          programmazione?: string;
          modalitaAccesso?: string;
          mode?: string;
        };
        if (v.mode === "OPEN" || v.mode === "CLOSED") {
          catalogueAccess = v.mode;
        } else {
          const blob = `${v.programmazione ?? ""} ${v.modalitaAccesso ?? ""}`.toLowerCase();
          if (/programmato|numero\s+chiuso/.test(blob)) catalogueAccess = "CLOSED";
          else if (
            /accesso\s*libero|\blibero\b|accesso\s+con\s+diploma/.test(blob)
          ) {
            catalogueAccess = "OPEN";
          }
        }
      } catch {
        /* ignore */
      }
    }
  }

  const inferredRegime = inferAdmissionRegime({
    sourceUrl,
    sourceType,
    access: parsed.accessMode.value,
    accessSnippet: parsed.accessMode.snippet,
    accessConfidence: parsed.accessMode.confidence,
    admissionGate: parsed.admissionGate,
    evaluationOnly: parsed.evaluationOnly,
    exams:
      parsed.examAlternatives.length >= 2
        ? parsed.examAlternatives
        : parsed.exams,
    examsSnippet:
      (parsed.examAlternatives[0] || parsed.exams[0])?.name ?? null,
    examsConfidence: parsed.examsConfidence,
    languageRequirement: parsed.languageLevel?.value ?? null,
    languageSnippet: parsed.languageLevel?.snippet ?? null,
    languageConfidence: parsed.languageLevel?.confidence,
    euSeats: parsed.euSeats?.value ?? null,
    nonEuSeats: parsed.nonEuSeats?.value ?? null,
    totalSeats: parsed.totalSeats?.value ?? null,
    seatsSnippet:
      parsed.euSeats?.snippet ??
      parsed.nonEuSeats?.snippet ??
      parsed.totalSeats?.snippet ??
      null,
    seatsConfidence:
      parsed.euSeats?.confidence ??
      parsed.nonEuSeats?.confidence ??
      parsed.totalSeats?.confidence,
    ownership: ownership === "UNKNOWN" ? parsed.publicPrivate : ownership,
  });
  let regime = input.regime
    ? {
        ...input.regime,
        ownership:
          input.regime.ownership.value === "UNKNOWN" && ownership !== "UNKNOWN"
            ? { ...input.regime.ownership, value: ownership }
            : input.regime.ownership,
      }
    : inferredRegime;

  // Low-precedence Universitaly catalogue signal when pages did not state access.
  // Private + catalogue "libero" stays UNKNOWN (same rule as inferAdmissionRegime).
  if (
    regime.access.value === "UNKNOWN" &&
    (catalogueAccess === "OPEN" || catalogueAccess === "CLOSED") &&
    !(ownership === "PRIVATE" && catalogueAccess === "OPEN")
  ) {
    const uniAccess = inferAdmissionRegime({
      sourceUrl: null,
      sourceType: "UNIVERSITALY",
      access: catalogueAccess,
      accessSnippet: "Universitaly programmazione/modalitaAccesso",
      accessConfidence: "LOW",
      ownership,
      euSeats: regime.seats.value.eu,
      nonEuSeats: regime.seats.value.nonEu,
      totalSeats: regime.seats.value.total,
    });
    regime = mergeAdmissionRegime([uniAccess, regime]);
  }

  await upsertFact({
    programId: pay.programId,
    programAcademicYearId: pay.id,
    field: "ADMISSION_REGIME",
    value: regime,
    sourceDocumentId,
    sourceUrl,
    academicYear: pay.academicYear,
    sourceType,
    extractionMethod,
    confidence: regime.access.confidence,
    rawValue: regime.access.snippet ?? regime.selection.snippet ?? undefined,
  });

  if (parsed.languages.length > 0) {
    hadSignal = true;
    await upsertFact({
      programId: pay.programId,
      programAcademicYearId: pay.id,
      field: "TEACHING_LANGUAGE",
      value: { languages: parsed.languages, fromCall: sourceType === "ADMISSION_CALL" },
      sourceDocumentId,
      sourceUrl,
      academicYear: pay.academicYear,
      sourceType,
      extractionMethod,
      confidence: "MEDIUM",
    });
    await prisma.program.update({
      where: { id: pay.programId },
      data: {
        teachingLanguagesJson: JSON.stringify(parsed.languages),
        language: parsed.languages[0] ?? pay.program.language,
      },
    });
  }

  if (parsed.languageLevel) {
    hadSignal = true;
    const langName = parsed.languages[0] || "English";
    await upsertFact({
      programId: pay.programId,
      programAcademicYearId: pay.id,
      field: "LANGUAGE_REQUIREMENT",
      value: { language: langName, level: parsed.languageLevel.value },
      sourceDocumentId,
      sourceUrl,
      academicYear: pay.academicYear,
      sourceType,
      extractionMethod,
      confidence: parsed.languageLevel.confidence,
      rawValue: parsed.languageLevel.snippet,
    });
    const existingLangReq = pay.requirements.find((r) => r.type === "LANGUAGE");
    const desc = `${langName} ${parsed.languageLevel.value}`;
    const valueJson = JSON.stringify({
      language: langName,
      level: parsed.languageLevel.value,
    });
    if (existingLangReq) {
      await prisma.admissionRequirement.update({
        where: { id: existingLangReq.id },
        data: { description: desc, valueJson },
      });
    } else {
      await prisma.admissionRequirement.create({
        data: {
          programAcademicYearId: pay.id,
          type: "LANGUAGE",
          required: true,
          description: desc,
          valueJson,
          hardExclusion: false,
        },
      });
    }
  }

  if (
    !input.deferAdministrativeFields &&
    (parsed.tuitionMin || parsed.tuitionMax || parsed.tuitionFixed)
  ) {
    hadSignal = true;
    if (writeLegacyProjection) await prisma.tuitionInfo.upsert({
      where: { programAcademicYearId: pay.id },
      create: {
        programAcademicYearId: pay.id,
        minTuition: parsed.tuitionMin?.value ?? null,
        maxTuition: parsed.tuitionMax?.value ?? null,
        fixedTuition: parsed.tuitionFixed?.value ?? null,
        incomeBased: parsed.incomeBased,
        currency: "EUR",
      },
      update: {
        minTuition: parsed.tuitionMin?.value ?? undefined,
        maxTuition: parsed.tuitionMax?.value ?? undefined,
        fixedTuition: parsed.tuitionFixed?.value ?? undefined,
        incomeBased: parsed.incomeBased,
      },
    });
    await upsertFact({
      programId: pay.programId,
      programAcademicYearId: pay.id,
      field: "TUITION",
      value: {
        min: parsed.tuitionMin?.value ?? null,
        max: parsed.tuitionMax?.value ?? null,
        fixed: parsed.tuitionFixed?.value ?? null,
        incomeBased: parsed.incomeBased,
        scope: parsed.tuitionScope,
      },
      sourceDocumentId,
      sourceUrl,
      academicYear: pay.academicYear,
      sourceType,
      extractionMethod,
      confidence:
        parsed.tuitionMax?.confidence ||
        parsed.tuitionMin?.confidence ||
        "MEDIUM",
      rawValue: parsed.tuitionMax?.snippet || parsed.tuitionMin?.snippet,
    });
  }

  const deadlineDates = parsed.deadlines
    .map((d) => ({ field: d, date: parseLooseDate(d.value) }))
    .filter((x): x is { field: (typeof parsed.deadlines)[0]; date: Date } => !!x.date);

  const relevantDeadlineDates = input.deferAdministrativeFields
    ? []
    : deadlineDates;
  if (
    relevantDeadlineDates.length > 0 ||
    parsed.nonEuSeats ||
    parsed.euSeats ||
    parsed.totalSeats
  ) {
    hadSignal = true;
    const primary = relevantDeadlineDates[0]?.date ?? null;
    const existingCycle = pay.cycles.find(() => true);
    if (writeLegacyProjection && existingCycle) {
      await prisma.admissionCycle.update({
        where: { id: existingCycle.id },
        data: {
          applicationDeadline:
            primary &&
            (!existingCycle.applicationDeadline || sourceType === "ADMISSION_CALL")
              ? primary
              : existingCycle.applicationDeadline,
          nonEuSeats:
            parsed.nonEuSeats?.value ?? existingCycle.nonEuSeats,
          euSeats: parsed.euSeats?.value ?? existingCycle.euSeats,
          totalSeats: parsed.totalSeats?.value ?? existingCycle.totalSeats,
        },
      });
    } else if (
      writeLegacyProjection &&
      (primary || parsed.nonEuSeats || parsed.euSeats || parsed.totalSeats)
    ) {
      await prisma.admissionCycle.create({
        data: {
          programAcademicYearId: pay.id,
          roundName: "Round 1",
          applicationDeadline: primary,
          nonEuSeats: parsed.nonEuSeats?.value ?? null,
          euSeats: parsed.euSeats?.value ?? null,
          totalSeats: parsed.totalSeats?.value ?? null,
          applicantCategory: "ALL",
        },
      });
    }
    if (primary) {
      await upsertFact({
        programId: pay.programId,
        programAcademicYearId: pay.id,
        field: "APPLICATION_DEADLINE",
        value: {
          date: primary.toISOString(),
          raw: relevantDeadlineDates[0].field.value,
        },
        sourceDocumentId,
        sourceUrl,
        academicYear: pay.academicYear,
        sourceType,
        extractionMethod,
        confidence: relevantDeadlineDates[0].field.confidence,
        rawValue: relevantDeadlineDates[0].field.snippet,
      });
    }
  }

  let accessMode = pay.accessMode || "UNKNOWN";
  if (regime.access.value !== "UNKNOWN") {
    hadSignal = true;
    accessMode = regime.access.value;
    await upsertFact({
      programId: pay.programId,
      programAcademicYearId: pay.id,
      field: "ACCESS_TYPE",
      value: {
        mode: regime.access.value,
        selection: regime.selection.value,
        unlimitedSeats: regime.seats.value.unlimited,
        euSeats: regime.seats.value.eu,
        nonEuSeats: regime.seats.value.nonEu,
        totalSeats: regime.seats.value.total,
        fromCall: sourceType === "ADMISSION_CALL",
      },
      sourceDocumentId,
      sourceUrl,
      academicYear: pay.academicYear,
      sourceType,
      extractionMethod,
      confidence: regime.access.confidence,
      rawValue: regime.access.snippet ?? undefined,
    });
  }

  const examParts = regime.admissionExams.value;
  if (examParts.length > 0) {
    hadSignal = true;
    const description =
      examParts.length > 1
        ? formatExamAlternatives(examParts)
        : examParts
            .map((e) => (e.detail ? `${e.name} ${e.detail}` : e.name))
            .join(", ");
    const primaryType = /SAT/i.test(examParts[0].name)
      ? "SAT"
      : /TOLC/i.test(examParts[0].name)
        ? "TOLC"
        : "ADMISSION_TEST";
    const valueJson = JSON.stringify({
      alternatives: examParts,
      name: examParts[0].name,
    });
    const existingExam = pay.requirements.find((r) =>
      ["SAT", "TOLC", "ADMISSION_TEST"].includes(r.type)
    );
    if (existingExam) {
      await prisma.admissionRequirement.update({
        where: { id: existingExam.id },
        data: { description, valueJson, type: primaryType },
      });
    } else {
      await prisma.admissionRequirement.create({
        data: {
          programAcademicYearId: pay.id,
          type: primaryType,
          required: true,
          description,
          valueJson,
          hardExclusion: false,
        },
      });
    }
    await upsertFact({
      programId: pay.programId,
      programAcademicYearId: pay.id,
      field: "ADMISSION_EXAMS",
      value: { alternatives: examParts, description },
      sourceDocumentId,
      sourceUrl,
      academicYear: pay.academicYear,
      sourceType,
      extractionMethod,
      confidence: parsed.examsConfidence,
      rawValue: description,
    });
  }

  if (parsed.careerOutcomes) {
    hadSignal = true;
    await upsertFact({
      programId: pay.programId,
      programAcademicYearId: pay.id,
      field: "CAREER_OUTCOMES",
      value: { text: parsed.careerOutcomes.value },
      rawValue: parsed.careerOutcomes.value,
      sourceDocumentId,
      sourceUrl,
      academicYear: pay.academicYear,
      sourceType,
      extractionMethod,
      confidence: parsed.careerOutcomes.confidence,
    });
  }

  if (parsed.publicPrivate !== "UNKNOWN") {
    const current = (pay.program.university.publicPrivate || "UNKNOWN").toUpperCase();
    const canWrite =
      current === "UNKNOWN" ||
      (parsed.publicPrivate === "PRIVATE" && current !== "PRIVATE");
    if (canWrite) {
      await prisma.university.update({
        where: { id: pay.program.universityId },
        data: { publicPrivate: parsed.publicPrivate },
      });
    }
  }

  return { accessMode, hadSignal };
}

async function persistEnrichmentTrace(
  pay: { id: string; programId: string; academicYear: string },
  trace: EnrichmentTrace,
  sourceDocumentId?: string
) {
  await upsertFact({
    programId: pay.programId,
    programAcademicYearId: pay.id,
    field: "ENRICHMENT_TRACE",
    value: trace,
    sourceDocumentId,
    sourceUrl: trace.officialUrl ?? undefined,
    academicYear: pay.academicYear,
    sourceType: "PROGRAMME_PAGE",
    extractionMethod: "HTML_SECTION",
    confidence: "MEDIUM",
  });
}

function makeEnrichmentTrace(input: {
  officialUrl: string | null;
  payAcademicYear: string;
  fetchFailed?: boolean;
  enrichFailed?: boolean;
  enrichFailureReason?: string | null;
  documents?: EnrichmentDocumentTrace[];
  parsed?: CallTextParse | null;
  falseSourceRejections?: number;
}): EnrichmentTrace {
  const documents = input.documents ?? [];
  return {
    officialUrl: input.officialUrl,
    targetIntakeYear: DEFAULT_TARGET_ACADEMIC_YEAR,
    payAcademicYear: input.payAcademicYear,
    fetchFailed: input.fetchFailed ?? false,
    enrichFailed: input.enrichFailed ?? false,
    enrichFailureReason: input.enrichFailureReason ?? null,
    hasAdmissionCallDocument: documents.some((d) => d.sourceType === "ADMISSION_CALL"),
    documents,
    parsed: input.parsed ?? null,
    falseSourceRejections: input.falseSourceRejections ?? 0,
    ocrSuccessCount: documents.filter((d) => d.ocrSucceeded).length,
    ocrFailureCount: documents.filter((d) => d.ocrAttempted && !d.ocrSucceeded).length,
    manualVerifiedFields: [],
  };
}

function traceFromFetch(
  url: string,
  body: string,
  sourceType: "ADMISSION_CALL" | "PROGRAMME_PAGE",
  method: string,
  fetchOk: boolean,
  academicYear: string
): EnrichmentDocumentTrace {
  const isPdf = method.startsWith("PDF") || /\.pdf(\?|#|$)/i.test(url);
  const ocrAttempted =
    body.startsWith("PDF_OCR\n") ||
    (process.env.BANDO_OCR === "1" && isPdf);
  const ocrSucceeded = body.startsWith("PDF_OCR\n") && body.length > 20;
  const parseQuality =
    body.startsWith("PDF_EXTRACTION_") || body.startsWith("FETCH_")
      ? "EMPTY"
      : parseCallText(body, url, { academicYear }).quality;
  return {
    url,
    sourceType,
    academicYear,
    extractionQuality:
      parseQuality === "EMPTY" ? "NEEDS_REVIEW" : parseQuality === "LOW" ? "LOW_EXTRACTION_QUALITY" : "OK",
    parserVersion: PARSER_VERSION,
    parseQuality,
    body: body.slice(0, 500),
    isPdf,
    ocrAttempted,
    ocrSucceeded,
    fetchOk,
  };
}

export type DeepEnrichResult = { ok: boolean; reason?: string };

/**
 * Deep enrich for one ProgramAcademicYear.
 * Discovers bando/tasse/requisiti URLs, extracts text PDF via pdf-parse, writes ADMISSION_CALL facts.
 * Scanned PDFs: OCR only when BANDO_OCR=1 (see admission-call adapter).
 */
export async function deepEnrichProgram(
  programAcademicYearId: string,
  options?: { deferAdministrativeFields?: boolean }
): Promise<DeepEnrichResult> {
  const pay = await prisma.programAcademicYear.findUnique({
    where: { id: programAcademicYearId },
    include: {
      program: { include: { university: true } },
      tuition: true,
      cycles: true,
      requirements: true,
    },
  });
  if (!pay) return { ok: false, reason: "pay_missing" };

  // Remove facts derived from an older discovery mistake (e.g. a transport
  // subsidy "bando"). They otherwise outrank the genuine programme page on
  // every later refresh because ADMISSION_CALL has higher source priority.
  const priorCallDocuments = await prisma.sourceDocument.findMany({
    where: { programAcademicYearId: pay.id, sourceType: "ADMISSION_CALL" },
    select: { id: true, url: true },
  });
  const unrelatedDocumentIds = priorCallDocuments
    .filter((document) => isClearlyNonAdmissionNotice(document.url))
    .map((document) => document.id);
  if (unrelatedDocumentIds.length > 0) {
    await prisma.programFact.updateMany({
      where: {
        programAcademicYearId: pay.id,
        sourceDocumentId: { in: unrelatedDocumentIds },
        superseded: false,
      },
      data: { superseded: true },
    });
  }

  const officialUrl = pay.program.officialUrl;
  const documentTraces: EnrichmentDocumentTrace[] = [];
  let falseSourceRejections = unrelatedDocumentIds.length;

  if (!officialUrl) {
    await persistEnrichmentTrace(
      pay,
      makeEnrichmentTrace({
        officialUrl: null,
        payAcademicYear: pay.academicYear,
        enrichFailed: true,
        enrichFailureReason: "no_official_url",
        falseSourceRejections,
      })
    );
    return { ok: false, reason: "no_official_url" };
  }

  const isPdfUrl = officialUrl.toLowerCase().endsWith(".pdf");
  const fetched = await fetchWithTimeout(officialUrl, isPdfUrl);
  if (!fetched.ok && !fetched.body.startsWith("PDF_EXTRACTION_")) {
    documentTraces.push(
      traceFromFetch(
        officialUrl,
        fetched.body,
        "PROGRAMME_PAGE",
        isPdfUrl ? "PDF_TEXT" : "HTML_SECTION",
        false,
        pay.academicYear
      )
    );
    await persistEnrichmentTrace(
      pay,
      makeEnrichmentTrace({
        officialUrl,
        payAcademicYear: pay.academicYear,
        fetchFailed: true,
        enrichFailed: true,
        enrichFailureReason: "fetch_failed",
        documents: documentTraces,
        falseSourceRejections,
      })
    );
    await prisma.programAcademicYear.update({
      where: { id: pay.id },
      data: {
        dossierEnrichedAt: new Date(),
        lastUpdatedAt: new Date(),
        dataConfidence: pay.dataConfidence === "HIGH" ? "HIGH" : "LOW",
      },
    });
    return { ok: false, reason: "fetch_failed" };
  }

  const isHtml =
    /html/i.test(fetched.contentType) ||
    /<!doctype html|<html/i.test(fetched.body.slice(0, 500));
  const contentIsPdf =
    /pdf/i.test(fetched.contentType) || (!isHtml && isPdfUrl);

  let bestParsed: CallTextParse | null = null;
  let bestUrl = officialUrl;
  let bestSourceType: "ADMISSION_CALL" | "PROGRAMME_PAGE" = contentIsPdf
    ? "ADMISSION_CALL"
    : "PROGRAMME_PAGE";
  let bestMethod = contentIsPdf ? "PDF_TEXT" : "HTML_SECTION";
  let bestBody = fetched.body;
  let bestCoverage = -1;
  let fetchCount = 1;
  const parsedDocuments: ParsedDocument[] = [];

  const consider = (
    parsed: CallTextParse,
    url: string,
    body: string,
    sourceType: "ADMISSION_CALL" | "PROGRAMME_PAGE",
    method: string,
    fetchOk = true
  ) => {
    documentTraces.push(
      traceFromFetch(url, body, sourceType, method, fetchOk, pay.academicYear)
    );
    if (parsed.quality === "EMPTY") return;
    parsedDocuments.push({ parsed, url, body, sourceType, method });
    const cov = fieldCoverageScore(parsed);
    const better =
      cov > bestCoverage ||
      (cov === bestCoverage &&
        sourceType === "ADMISSION_CALL" &&
        bestSourceType !== "ADMISSION_CALL") ||
      (cov === bestCoverage && parsed.quality === "OK" && bestParsed?.quality !== "OK");
    if (better) {
      bestCoverage = cov;
      bestParsed = parsed;
      bestUrl = url;
      bestBody = body;
      bestSourceType = sourceType;
      bestMethod = method;
    }
  };

  if (contentIsPdf || !isHtml) {
    const callFetched = contentIsPdf
      ? fetched
      : await fetchWithTimeout(officialUrl, true);
    if (!contentIsPdf) fetchCount += 1;
    const method =
      callFetched.body.startsWith("PDF_OCR_") ||
      (process.env.BANDO_OCR === "1" && callFetched.contentType.includes("pdf"))
        ? "PDF_OCR"
        : "PDF_TEXT";
    // Strip OCR prefix marker if present
    const body = callFetched.body.startsWith("PDF_OCR\n")
      ? callFetched.body.slice("PDF_OCR\n".length)
      : callFetched.body;
    consider(
      parseCallText(body, officialUrl, { academicYear: pay.academicYear }),
      officialUrl,
      body,
      "ADMISSION_CALL",
      method
    );
  } else {
    const discovered = [
      ...admissionSiblingUrls(officialUrl, {
        includeTuition: !options?.deferAdministrativeFields,
      }),
      ...discoverBandoUrls(fetched.body, officialUrl, {
        academicYear: pay.academicYear,
        limit: 8,
        includeTuition: !options?.deferAdministrativeFields,
      }),
    ].filter(
      (c, i, arr) => arr.findIndex((x) => x.url === c.url) === i
    );
    // Prefer Unibo how-to-enrol / admission siblings and real bandi first.
    const follow = pickFollowLinks(discovered, 4, officialUrl, {
      includeTuition: !options?.deferAdministrativeFields,
    });
    const uniboFirst = discovered.filter((c) =>
      /how-to-enrol|\/admission|iscriversi|\/ammissione|bando.*clef|call-for-application/i.test(
        c.url
      )
    );
    const bandoFirst = discovered.filter((c) => c.kind === "bando" || c.kind === "other");
    const ordered = [...uniboFirst, ...follow, ...bandoFirst].filter(
      (c, i, arr) => arr.findIndex((x) => x.url === c.url) === i
    );

    for (const c of ordered) {
      if (fetchCount >= 5) break;
      if (isRejectedEnrichmentCandidateUrl(c.url)) {
        falseSourceRejections += 1;
        continue;
      }
      const callFetched = await fetchWithTimeout(c.url, true);
      fetchCount += 1;
      if (!callFetched.ok && !callFetched.body.startsWith("PDF_EXTRACTION_")) {
        continue;
      }
      const isPdf =
        /pdf/i.test(callFetched.contentType) || c.isPdf;
      const body = callFetched.body.startsWith("PDF_OCR\n")
        ? callFetched.body.slice("PDF_OCR\n".length)
        : callFetched.body;
      const method = isPdf
        ? callFetched.body.startsWith("PDF_OCR\n")
          ? "PDF_OCR"
          : "PDF_TEXT"
        : "HTML_SECTION";
      consider(
        parseCallText(body, c.url, { academicYear: pay.academicYear }),
        c.url,
        body,
        "ADMISSION_CALL",
        method
      );
    }

    // Always also score programme page itself
    consider(
      parseCallText(fetched.body, officialUrl, {
        academicYear: pay.academicYear,
      }),
      officialUrl,
      fetched.body,
      "PROGRAMME_PAGE",
      "HTML_SECTION"
    );
    if (!bestParsed || bestCoverage < 0) {
      bestParsed = parseCallText(fetched.body, officialUrl, {
        academicYear: pay.academicYear,
      });
      bestUrl = officialUrl;
      bestBody = fetched.body;
      bestSourceType = "PROGRAMME_PAGE";
      bestMethod = "HTML_SECTION";
    }
  }

  const quality = bestParsed?.quality ?? "EMPTY";
  const mergedParsed = mergeParsedDocuments(parsedDocuments) ?? bestParsed;
  const mergedRegime =
    parsedDocuments.length > 0
      ? mergeAdmissionRegime(parsedDocuments.map(regimeFromDocument))
      : undefined;
  const snap = await upsertSourceDocument({
    sourceType: bestSourceType,
    sourceAuthority: pay.program.name,
    url: bestUrl,
    title:
      bestSourceType === "ADMISSION_CALL"
        ? `${pay.program.name} — admission call`
        : `${pay.program.name} — programme page`,
    academicYear: pay.academicYear,
    universityId: pay.program.universityId,
    programId: pay.programId,
    programAcademicYearId: pay.id,
    contentType: bestMethod.startsWith("PDF") ? "pdf" : "html",
    body: bestBody.slice(0, 100_000),
    status: "FETCHED",
    extractionQuality: extractionQualityLabel(quality),
  });

  if (!mergedParsed || quality === "EMPTY") {
    await persistEnrichmentTrace(
      pay,
      makeEnrichmentTrace({
        officialUrl,
        payAcademicYear: pay.academicYear,
        enrichFailed: true,
        enrichFailureReason: "low_extraction_quality",
        documents: documentTraces,
        parsed: mergedParsed,
        falseSourceRejections,
      }),
      snap?.document.id
    );
    await prisma.programAcademicYear.update({
      where: { id: pay.id },
      data: {
        dossierEnrichedAt: new Date(),
        lastUpdatedAt: new Date(),
        dataConfidence: pay.dataConfidence === "HIGH" ? "HIGH" : "LOW",
      },
    });
    return { ok: false, reason: "low_extraction_quality" };
  }

  const payFresh = {
    ...pay,
    requirements: await prisma.admissionRequirement.findMany({
      where: { programAcademicYearId: pay.id },
      select: { id: true, type: true },
    }),
    cycles: await prisma.admissionCycle.findMany({
      where: { programAcademicYearId: pay.id },
      select: {
        id: true,
        applicationDeadline: true,
        euSeats: true,
        nonEuSeats: true,
        totalSeats: true,
      },
    }),
  };

  await persistScopedQuotaFacts(pay, parsedDocuments);

  const { accessMode, hadSignal } = await applyParsedFacts({
    pay: payFresh,
    parsed: mergedParsed,
    sourceDocumentId: snap.document.id,
    sourceUrl: bestUrl,
    sourceType: bestSourceType,
    extractionMethod: bestMethod,
    regime: mergedRegime,
    deferAdministrativeFields: options?.deferAdministrativeFields,
  });

  await prisma.programAcademicYear.update({
    where: { id: pay.id },
    data: {
      accessMode,
      dossierEnrichedAt: new Date(),
      lastUpdatedAt: new Date(),
      dataConfidence:
        pay.dataConfidence === "HIGH"
          ? "HIGH"
          : bestSourceType === "ADMISSION_CALL" && quality === "OK"
            ? "MEDIUM"
            : hadSignal
              ? "MEDIUM"
              : "LOW",
    },
  });

  await persistEnrichmentTrace(
    pay,
    makeEnrichmentTrace({
      officialUrl,
      payAcademicYear: pay.academicYear,
      documents: documentTraces,
      parsed: mergedParsed,
      falseSourceRejections,
    }),
    snap.document.id
  );

  if (quality === "LOW") {
    return { ok: true, reason: "low_extraction_quality" };
  }
  return { ok: true };
}
