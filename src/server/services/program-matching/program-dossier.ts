import { PARSER_VERSION, PROGRAM_DOSSIER_TTL_DAYS } from "@/lib/program-matching/config";
import { parseJsonArray } from "@/lib/parse-json-array";
import type { ProgramFieldStatusMap } from "@/lib/program-matching/field-status";
import {
  buildFieldStatusesFromDossier,
  parseFieldStatusFact,
  type EnrichmentTrace,
} from "@/server/services/program-ingestion/field-reason-classifier";
import type { CriticalProgramField } from "@/lib/program-matching/field-status";
import {
  examinerLinkForExam,
  formatExamAlternatives,
} from "@/lib/program-matching/examiner-links";
import {
  regionForCity,
} from "@/lib/program-matching/taxonomy";
import { prisma } from "@/lib/db";
import { inferPublicPrivateFromUniversityName } from "@/server/services/program-ingestion/infer-public-private";
import { sanitizeTuitionPair } from "@/server/services/program-ingestion/call-text-parse";
import type { SelectionRegime } from "@/server/services/program-ingestion/admission-regime";
import type { ApplicantCategory } from "@/lib/program-matching/types";
import {
  resolveProgramFact,
  resolveProgramFactCollection,
  type FactCandidate,
} from "./source-resolver";

export type CallFreshness = "current" | "indicative" | "unknown";
export type AccessMode = "OPEN" | "CLOSED" | "UNKNOWN";

export type ProgramDossierExam = {
  label: string;
  type: string;
  examinerUrl: string | null;
  examinerLabel: string | null;
};

export type ProgramDossier = {
  programAcademicYearId: string;
  programId: string;
  city: string | null;
  region: string | null;
  universityName: string;
  publicPrivate: string;
  programName: string;
  teachingLanguages: string[];
  languageRequirement: string | null;
  tuitionMin: number | null;
  tuitionMax: number | null;
  tuitionFixed: number | null;
  accessMode: AccessMode;
  selection: SelectionRegime;
  euSeats: number | null;
  nonEuSeats: number | null;
  quotaSeats: number | null;
  quotaScope: string | null;
  seatsUnlimited: boolean;
  exams: ProgramDossierExam[];
  examsDisplay: string | null;
  deadlines: Array<{ roundName: string; deadline: Date | null }>;
  careerOutcomes: string | null;
  callFreshness: CallFreshness;
  indicativeFromYear: string | null;
  academicYear: string;
  dataConfidence: string;
  dossierEnrichedAt: Date | null;
  officialUrl: string | null;
  admissionCallUrl: string | null;
  extractQuality: string | null;
  sourceUrls: string[];
  isFresh: boolean;
  fieldStatuses: ProgramFieldStatusMap;
  criticalFacts: Array<{
    id?: string;
    field: string;
    value: string;
    scope: string | null;
    freshness: string | null;
    confidence: string | null;
    quote: string | null;
    sourceUrl: string | null;
    origin: string | null;
  }>;
};

function parseFactJson(raw: string | null | undefined): unknown {
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function numericValue(
  value: unknown,
  keys: string[]
): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  for (const key of keys) {
    const found = Number(record[key]);
    if (Number.isFinite(found)) return found;
  }
  return null;
}

function factText(value: unknown): string | null {
  if (typeof value === "string") return value.trim() || null;
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  return String(
    record.description || record.name || record.type || record.mode || ""
  ).trim() || null;
}

export function isDossierTimestampFresh(
  dossierEnrichedAt: Date | string | null | undefined,
  now = new Date()
): boolean {
  if (!dossierEnrichedAt) return false;
  const d =
    dossierEnrichedAt instanceof Date
      ? dossierEnrichedAt
      : new Date(dossierEnrichedAt);
  if (Number.isNaN(d.getTime())) return false;
  const ttlMs = PROGRAM_DOSSIER_TTL_DAYS * 24 * 60 * 60 * 1000;
  return now.getTime() - d.getTime() <= ttlMs;
}

export function deriveAccessMode(input: {
  accessMode?: string | null;
  accessFact?: Record<string, unknown> | null;
  hasAdmissionExam?: boolean;
  publicPrivate?: string | null;
}): AccessMode {
  const col = (input.accessMode || "").toUpperCase();
  let mode: AccessMode = "UNKNOWN";
  if (col === "OPEN" || col === "CLOSED") {
    mode = col;
  } else {
    const prog = String(
      input.accessFact?.programmazione ?? input.accessFact?.mode ?? ""
    ).toLowerCase();
    if (/numero\s*programmato|programmato|closed/i.test(prog)) {
      mode = "CLOSED";
    } else if (/accesso\s*libero|open\s*access|senza\s*numero/i.test(prog)) {
      mode = "OPEN";
    }
  }

  // SAT / TOLC / admission test = selection, not open enrolment.
  if (input.hasAdmissionExam) return "CLOSED";

  // Private unis are listed as "accesso libero" on Universitaly because they
  // are outside ministerial numerus clausus — that is not open admission.
  const ownership = (input.publicPrivate || "").toUpperCase();
  if (mode === "OPEN" && ownership === "PRIVATE") return "UNKNOWN";

  return mode;
}

/**
 * A partial programme page must not erase a known Universitaly access mode.
 * `ADMISSION_REGIME` is deliberately conservative and often carries UNKNOWN;
 * in that case fall back to the catalogue/fact evidence already stored on PAY.
 */
export function resolveDossierAccessMode(input: {
  manualAccessFact?: Record<string, unknown> | null;
  regimeAccess?: AccessMode | null;
  accessMode?: string | null;
  accessFact?: Record<string, unknown> | null;
  hasAdmissionExam?: boolean;
  publicPrivate?: string | null;
}): AccessMode {
  if (input.manualAccessFact) {
    return deriveAccessMode({
      accessMode: input.accessMode,
      accessFact: input.manualAccessFact,
      publicPrivate: input.publicPrivate,
    });
  }
  if (input.regimeAccess && input.regimeAccess !== "UNKNOWN") {
    return input.regimeAccess;
  }
  return deriveAccessMode({
    accessMode: input.accessMode,
    accessFact: input.accessFact,
    hasAdmissionExam: input.hasAdmissionExam,
    publicPrivate: input.publicPrivate,
  });
}

/** Open access on a public programme means no fixed seat quota unless a source says otherwise. */
export function deriveSeatsUnlimited(input: {
  accessMode: AccessMode;
  regimeUnlimited?: boolean | null;
  euSeats?: number | null;
  nonEuSeats?: number | null;
  totalSeats?: number | null;
}): boolean {
  if (input.regimeUnlimited) return true;
  return (
    input.accessMode === "OPEN" &&
    input.euSeats == null &&
    input.nonEuSeats == null &&
    input.totalSeats == null
  );
}

export function resolveDossierSelection(input: {
  regimeSelection?: SelectionRegime | null;
  accessMode: AccessMode;
  hasAdmissionExam: boolean;
}): SelectionRegime {
  if (input.regimeSelection && input.regimeSelection !== "UNKNOWN") {
    return input.regimeSelection;
  }
  if (input.hasAdmissionExam) return "ENTRANCE_EXAM";
  if (input.accessMode === "OPEN") return "NONE";
  return "UNKNOWN";
}

export function resolvePublicPrivate(
  stored: string | null | undefined,
  universityName: string
): string {
  const inferred = inferPublicPrivateFromUniversityName(universityName);
  if (inferred === "PRIVATE") return "PRIVATE";
  const cur = (stored || "UNKNOWN").toUpperCase();
  if (cur === "PUBLIC" || cur === "PRIVATE") return cur;
  return inferred;
}

export function examsDisplayLabel(
  exams: Array<{ label: string }>
): string | null {
  if (exams.length === 0) return null;
  const labels = [...new Set(exams.map((e) => e.label))];
  const filtered = labels.filter(
    (label) =>
      !labels.some(
        (other) => other !== label && other.toLowerCase().includes(label.toLowerCase())
      )
  );
  return (filtered.length ? filtered : labels).join(" · ");
}

export function deriveCallFreshness(input: {
  academicYear: string;
  indicativeFromYear?: string | null;
  hasAdmissionCallFact?: boolean;
}): CallFreshness {
  if (input.indicativeFromYear) return "indicative";
  if (input.hasAdmissionCallFact) return "current";
  return "unknown";
}

export async function isProgramDossierFresh(
  programAcademicYearId: string
): Promise<boolean> {
  const pay = await prisma.programAcademicYear.findUnique({
    where: { id: programAcademicYearId },
    select: {
      dossierEnrichedAt: true,
      tuition: { select: { id: true } },
      cycles: { select: { id: true }, take: 1 },
      facts: {
        where: {
          superseded: false,
          sourceType: { not: "UNIVERSITALY" },
        },
        select: { id: true },
        take: 1,
      },
      sourceDocuments: {
        where: { sourceType: { not: "UNIVERSITALY" } },
        select: { parserVersion: true },
        take: 8,
      },
    },
  });
  if (!pay || !isDossierTimestampFresh(pay.dossierEnrichedAt)) return false;
  if (pay.sourceDocuments.some((d) => d.parserVersion !== PARSER_VERSION)) {
    return false;
  }
  return !!(pay.tuition || pay.cycles.length > 0 || pay.facts.length > 0);
}

function manualVerifiedFieldsFromFacts(
  facts: Array<{ field: string; sourceType: string; superseded: boolean }>
): CriticalProgramField[] {
  return facts
    .filter((f) => f.sourceType === "MANUAL_VERIFIED" && !f.superseded)
    .flatMap((f) => {
      if (f.field === "ACCESS_TYPE") return ["access" as const];
      if (f.field === "ADMISSION_REGIME") return ["access" as const, "selection" as const];
      if (f.field === "TUITION") return ["tuition" as const];
      if (f.field === "APPLICATION_DEADLINE") return ["deadline" as const];
      return [];
    });
}

export async function getProgramDossier(
  programAcademicYearId: string,
  options?: { applicantCategory?: ApplicantCategory }
): Promise<ProgramDossier | null> {
  const pay = await prisma.programAcademicYear.findUnique({
    where: { id: programAcademicYearId },
    include: {
      program: { include: { university: true } },
      facts: { where: { superseded: false } },
      sourceDocuments: {
        orderBy: { retrievedAt: "desc" },
        take: 8,
      },
    },
  });
  if (!pay) return null;

  const applicantCategory = options?.applicantCategory ?? "UNKNOWN";
  const factRows = pay.facts as Array<(typeof pay.facts)[number] & FactCandidate>;
  const resolveOne = (field: string) =>
    resolveProgramFact(
      factRows.filter((fact) => fact.field === field),
      pay.academicYear,
      { applicantCategory }
    );
  const resolveMany = (field: string) =>
    resolveProgramFactCollection(
      factRows.filter((fact) => fact.field === field),
      pay.academicYear,
      applicantCategory
    );
  const accessFact = resolveOne("ACCESS_TYPE");
  const selectionFact = resolveOne("SELECTION");
  const tuitionFact = resolveOne("TUITION");
  const languageFact = resolveOne("LANGUAGE_REQUIREMENT");
  const deadlineFacts = resolveMany("APPLICATION_DEADLINE");
  const quotaFacts = resolveMany("SEATS");
  const campusFacts = resolveMany("CAMPUS");
  const examFacts = resolveMany("ADMISSION_EXAMS");
  const requiredDocumentFacts = resolveMany("REQUIRED_DOCUMENTS");
  const resolvedFacts = [
    accessFact,
    selectionFact,
    tuitionFact,
    languageFact,
    ...deadlineFacts,
    ...quotaFacts,
    ...campusFacts,
    ...examFacts,
    ...requiredDocumentFacts,
  ].filter((fact): fact is (typeof factRows)[number] => !!fact);

  const accessValue = parseFactJson(accessFact?.normalizedValueJson);
  const accessRecord =
    accessValue && typeof accessValue === "object"
      ? (accessValue as Record<string, unknown>)
      : {};
  const accessRaw =
    typeof accessValue === "string"
      ? accessValue
      : String(accessRecord.mode || accessRecord.access || "");
  const accessMode: AccessMode =
    accessRaw === "OPEN" || accessRaw === "CLOSED" ? accessRaw : "UNKNOWN";
  const selectionValue = parseFactJson(selectionFact?.normalizedValueJson);
  const selectionRaw =
    typeof selectionValue === "string"
      ? selectionValue
      : selectionValue && typeof selectionValue === "object"
        ? String(
            (selectionValue as Record<string, unknown>).selection ||
              (selectionValue as Record<string, unknown>).mode ||
              (selectionValue as Record<string, unknown>).type ||
              ""
          )
        : "";
  const selection: SelectionRegime = [
    "NONE",
    "EVALUATION",
    "ENTRANCE_EXAM",
  ].includes(selectionRaw)
    ? (selectionRaw as SelectionRegime)
    : "UNKNOWN";
  const publicPrivate = resolvePublicPrivate(
    pay.program.university.publicPrivate,
    pay.program.university.name
  );

  const quotaValues = quotaFacts
    .map((fact) =>
      numericValue(parseFactJson(fact.normalizedValueJson), [
        "places",
        "seats",
        "count",
      ])
    )
    .filter((value): value is number => value != null);
  const distinctQuotaValues = [...new Set(quotaValues)];
  const quotaSeats =
    distinctQuotaValues.length === 1 ? distinctQuotaValues[0] : null;
  const quotaScope = quotaSeats != null ? applicantCategory : null;
  const euSeats =
    applicantCategory === "EU_CITIZEN" ||
    applicantCategory === "EU_EQUIVALENT"
      ? quotaSeats
      : null;
  const nonEuSeats =
    applicantCategory === "NON_EU_RESIDENT_ABROAD" ||
    applicantCategory === "NON_EU_RESIDENT_ITALY"
      ? quotaSeats
      : null;

  const teachingLanguages =
    parseJsonArray(pay.program.teachingLanguagesJson).length > 0
      ? parseJsonArray(pay.program.teachingLanguagesJson)
      : pay.program.language
        ? [pay.program.language]
        : [];

  const hasCall = resolvedFacts.some((f) => f.sourceType === "ADMISSION_CALL");
  const callDoc = pay.sourceDocuments.find(
    (d) =>
      d.sourceType === "ADMISSION_CALL" &&
      resolvedFacts.some((fact) => fact.sourceDocumentId === d.id)
  );
  const admissionCallUrl =
    resolvedFacts.find((f) => f.sourceType === "ADMISSION_CALL")?.sourceUrl ||
    callDoc?.url ||
    null;
  const extractQuality =
    callDoc?.extractionQuality ||
    pay.sourceDocuments[0]?.extractionQuality ||
    null;

  const sourceUrls = [
    ...new Set(
      [
        admissionCallUrl,
        pay.program.officialUrl,
        ...resolvedFacts.map((f) => f.sourceUrl).filter(Boolean),
      ].filter(Boolean) as string[]
    ),
  ];

  const campusCities = campusFacts
    .map((fact) => {
      const value = parseFactJson(fact.normalizedValueJson);
      if (typeof value === "string") return value.trim();
      return value && typeof value === "object"
        ? String((value as Record<string, unknown>).city || "").trim()
        : "";
    })
    .filter(Boolean);
  const uniqueCampusCities = [...new Set(campusCities)];
  const city = uniqueCampusCities.length === 1 ? uniqueCampusCities[0] : null;
  const region = city ? regionForCity(city) : null;

  const tuitionValue = parseFactJson(tuitionFact?.normalizedValueJson);
  const tuitionRecord =
    tuitionValue && typeof tuitionValue === "object"
      ? (tuitionValue as Record<string, unknown>)
      : {};
  const tuition = sanitizeTuitionPair(
    numericValue(tuitionRecord, ["min", "minTuition"]),
    numericValue(tuitionRecord, ["max", "maxTuition"])
  );
  const tuitionFixed = numericValue(tuitionRecord, ["fixed", "fixedTuition"]);
  const languageValue = parseFactJson(languageFact?.normalizedValueJson);
  const languageRequirement =
    factText(languageValue) ||
    (languageValue && typeof languageValue === "object"
      ? String(
          (languageValue as Record<string, unknown>).level ||
            (languageValue as Record<string, unknown>).minLevel ||
            ""
        ).trim() || null
      : null);
  const deadlines = deadlineFacts
    .map((fact, index) => {
      const value = parseFactJson(fact.normalizedValueJson);
      const record =
        value && typeof value === "object"
          ? (value as Record<string, unknown>)
          : {};
      const raw =
        typeof value === "string"
          ? value
          : String(record.date || record.deadline || "");
      const deadline = raw ? new Date(raw) : null;
      return {
        roundName: String(record.roundName || `Round ${index + 1}`),
        deadline:
          deadline && !Number.isNaN(deadline.getTime()) ? deadline : null,
      };
    })
    .filter((row) => row.deadline);
  const exams: ProgramDossierExam[] = examFacts.flatMap((fact) => {
    const value = parseFactJson(fact.normalizedValueJson);
    const record =
      value && typeof value === "object"
        ? (value as Record<string, unknown>)
        : {};
    const alternatives = Array.isArray(record.alternatives)
      ? record.alternatives
      : [];
    const labels =
      alternatives.length > 0
        ? [
            formatExamAlternatives(
              alternatives.map((item) => {
                if (typeof item === "string") return { name: item };
                const record = item as Record<string, unknown>;
                return {
                  name: String(record.name || ""),
                  detail:
                    record.detail == null ? null : String(record.detail),
                };
              })
            ),
          ]
        : [factText(value)].filter((label): label is string => !!label);
    return labels.filter(Boolean).map((label) => {
      const link = examinerLinkForExam(label);
      return {
        label,
        type: String(record.type || "ADMISSION_TEST"),
        examinerUrl: link?.url ?? null,
        examinerLabel: link?.label ?? null,
      };
    });
  });

  const traceFact = pay.facts.find((f) => f.field === "ENRICHMENT_TRACE");
  const fieldStatusFact = pay.facts.find((f) => f.field === "FIELD_STATUS");
  const enrichmentTrace: EnrichmentTrace | null = traceFact?.normalizedValueJson
    ? (() => {
        try {
          return JSON.parse(traceFact.normalizedValueJson) as EnrichmentTrace;
        } catch {
          return null;
        }
      })()
    : null;
  const manualVerifiedFields = [
    ...new Set([
      ...manualVerifiedFieldsFromFacts(pay.facts),
      ...(enrichmentTrace?.manualVerifiedFields ?? []),
    ]),
  ];

  const dossierSnapshot = {
    teachingLanguages,
    languageRequirement,
    accessMode,
    selection,
    examsDisplay: examsDisplayLabel(exams),
    tuitionMin: tuition.min,
    tuitionMax: tuition.max,
    tuitionFixed,
    deadlines,
    euSeats,
    nonEuSeats,
    seatsUnlimited: accessRecord.unlimitedSeats === true,
    callFreshness: deriveCallFreshness({
      academicYear: pay.academicYear,
      indicativeFromYear: pay.indicativeFromYear,
      hasAdmissionCallFact: hasCall,
    }),
    academicYear: pay.academicYear,
    officialUrl: pay.program.officialUrl,
    admissionCallUrl,
    extractQuality,
  };

  const fieldStatuses = buildFieldStatusesFromDossier({
    dossier: dossierSnapshot,
    trace: enrichmentTrace ?? {
      officialUrl: pay.program.officialUrl,
      targetIntakeYear: "2027/2028",
      payAcademicYear: pay.academicYear,
      fetchFailed: false,
      enrichFailed: !pay.dossierEnrichedAt,
      enrichFailureReason: null,
      hasAdmissionCallDocument: hasCall,
      documents: [],
      parsed: null,
      falseSourceRejections: 0,
      ocrSuccessCount: 0,
      ocrFailureCount: 0,
      manualVerifiedFields,
    },
    fieldStatusFact: parseFieldStatusFact(fieldStatusFact?.normalizedValueJson),
  });

  return {
    programAcademicYearId: pay.id,
    programId: pay.programId,
    city,
    region,
    universityName: pay.program.university.name,
    publicPrivate,
    programName: pay.program.name,
    teachingLanguages,
    languageRequirement,
    tuitionMin: tuition.min,
    tuitionMax: tuition.max,
    tuitionFixed,
    accessMode,
    selection,
    euSeats,
    nonEuSeats,
    quotaSeats,
    quotaScope,
    seatsUnlimited: accessRecord.unlimitedSeats === true,
    exams,
    examsDisplay: examsDisplayLabel(exams),
    deadlines,
    careerOutcomes: null,
    callFreshness: deriveCallFreshness({
      academicYear: pay.academicYear,
      indicativeFromYear: pay.indicativeFromYear,
      hasAdmissionCallFact: hasCall,
    }),
    indicativeFromYear: pay.indicativeFromYear,
    academicYear: pay.academicYear,
    dataConfidence:
      resolvedFacts.length >= 4
        ? "HIGH"
        : resolvedFacts.length > 0
          ? "MEDIUM"
          : "LOW",
    dossierEnrichedAt: pay.dossierEnrichedAt,
    officialUrl: pay.program.officialUrl,
    admissionCallUrl,
    extractQuality,
    sourceUrls,
    isFresh: resolvedFacts.length > 0,
    fieldStatuses,
    criticalFacts: resolvedFacts.map((fact) => ({
      id: fact.id,
      field: fact.field,
      value: fact.rawValue || fact.normalizedValueJson,
      scope: fact.applicantCategoryScope,
      freshness: fact.freshness,
      confidence: fact.confidence,
      quote: fact.evidenceQuote,
      sourceUrl: fact.sourceUrl,
      origin: fact.origin,
    })),
  };
}

export type EnsureDossierResult = {
  programAcademicYearId: string;
  reused: boolean;
  enriched: boolean;
  aiStatus?: string;
  reason?: string;
};

export type EnsureDossiersOptions = {
  applicantCategory?: import("@/lib/program-matching/types").ApplicantCategory;
  matchingContexts?: Map<
    string,
    import("@/server/services/program-enrichment/matching-context").MinimalMatchingContext
  >;
  onProgress?: (done: number, total: number, label: string) => void;
};

export function canReuseLegacyDossier(
  aiEnabled: boolean,
  legacyDossierFresh: boolean
): boolean {
  return !aiEnabled && legacyDossierFresh;
}

export function shouldUseDeterministicDossierFallback(
  aiEnabled: boolean
): boolean {
  return !aiEnabled;
}

/**
 * For each PAY: reuse shared dossier if fresh, otherwise AI-enrich (when enabled)
 * or deep-enrich from official URL only when AI enrichment is disabled.
 */
export async function ensureProgramDossiers(
  programAcademicYearIds: string[],
  options?: EnsureDossiersOptions
): Promise<EnsureDossierResult[]> {
  const {
    isProgramEnrichmentEnabled,
    enrichProgramWithAi,
  } = await import("@/server/services/program-enrichment");
  const results: EnsureDossierResult[] = [];
  const unique = [...new Set(programAcademicYearIds)];
  const aiOn = isProgramEnrichmentEnabled();
  let done = 0;

  for (const id of unique) {
    const legacyDossierFresh = await isProgramDossierFresh(id);
    if (canReuseLegacyDossier(aiOn, legacyDossierFresh)) {
      results.push({
        programAcademicYearId: id,
        reused: true,
        enriched: false,
        reason: "fresh_cache",
        aiStatus: aiOn ? "dossier_fresh" : "disabled_or_fresh",
      });
      done += 1;
      options?.onProgress?.(done, unique.length, `Досье ${done}/${unique.length}`);
      continue;
    }

    if (aiOn && options?.applicantCategory && options.matchingContexts?.has(id)) {
      const ctx = options.matchingContexts.get(id)!;
      const ai = await enrichProgramWithAi({
        programAcademicYearId: id,
        applicantCategory: options.applicantCategory,
        matchingContext: ctx,
        forShortlist: true,
      });
      if (ai.status === "SUCCEEDED" || ai.status === "REUSED") {
        results.push({
          programAcademicYearId: id,
          reused: ai.status === "REUSED",
          enriched: ai.status === "SUCCEEDED",
          aiStatus: ai.status,
          reason: ai.status,
        });
        done += 1;
        options?.onProgress?.(done, unique.length, `AI ${done}/${unique.length}`);
        continue;
      }
      results.push({
        programAcademicYearId: id,
        reused: false,
        enriched: false,
        aiStatus: ai.status,
        reason: ai.error ?? ai.status,
      });
      done += 1;
      options?.onProgress?.(done, unique.length, `AI ${done}/${unique.length}`);
      continue;
    }

    if (!shouldUseDeterministicDossierFallback(aiOn)) {
      results.push({
        programAcademicYearId: id,
        reused: false,
        enriched: false,
        reason: "missing_matching_context",
        aiStatus: "FAILED",
      });
      done += 1;
      options?.onProgress?.(done, unique.length, `AI ${done}/${unique.length}`);
      continue;
    }

    const { deepEnrichProgram } = await import(
      "@/server/services/program-ingestion/program-deep-enrich"
    );
    const enriched = await deepEnrichProgram(id, {
      deferAdministrativeFields: true,
    });
    results.push({
      programAcademicYearId: id,
      reused: false,
      enriched: enriched.ok,
      reason: enriched.reason,
      aiStatus: "DISABLED",
    });
    done += 1;
    options?.onProgress?.(done, unique.length, `Обогащение ${done}/${unique.length}`);
  }

  return results;
}
