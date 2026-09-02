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
import type { AdmissionRegime, SelectionRegime } from "@/server/services/program-ingestion/admission-regime";

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
};

function parseFactValue(raw: string): Record<string, unknown> {
  try {
    const v = JSON.parse(raw);
    return v && typeof v === "object" ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function parseAdmissionRegime(raw: string | null | undefined): AdmissionRegime | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Partial<AdmissionRegime>;
    if (!value.access?.value || !value.selection?.value || !value.seats?.value) {
      return null;
    }
    return value as AdmissionRegime;
  } catch {
    return null;
  }
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

function languageRequirementFromRequirements(
  requirements: Array<{ type: string; description: string | null; valueJson: string | null }>
): string | null {
  const lang = requirements.find((r) => r.type === "LANGUAGE");
  if (!lang) return null;
  if (lang.description) return lang.description;
  if (!lang.valueJson) return null;
  try {
    const v = JSON.parse(lang.valueJson) as {
      language?: string;
      level?: string;
      minLevel?: string;
    };
    const level = v.level || v.minLevel;
    if (v.language && level) return `${v.language} ${level}`;
    if (level) return String(level);
  } catch {
    /* ignore */
  }
  return null;
}

function examsFromRequirements(
  requirements: Array<{
    type: string;
    description: string | null;
    valueJson: string | null;
  }>
): ProgramDossierExam[] {
  const examTypes = new Set(["SAT", "TOLC", "ADMISSION_TEST", "IMAT"]);
  const out: ProgramDossierExam[] = [];

  for (const r of requirements) {
    if (!examTypes.has(r.type)) continue;
    let label = r.description || r.type;
    let alternatives: string[] = [];
    if (r.valueJson) {
      try {
        const v = JSON.parse(r.valueJson) as {
          alternatives?: Array<{ name?: string; detail?: string }>;
          test?: string;
          name?: string;
        };
        if (Array.isArray(v.alternatives) && v.alternatives.length > 0) {
          label = formatExamAlternatives(
            v.alternatives.map((a) => ({
              name: String(a.name || ""),
              detail: a.detail,
            }))
          );
          alternatives = v.alternatives.map((a) => String(a.name || ""));
        } else if (v.test || v.name) {
          label = r.description || String(v.test || v.name);
        }
      } catch {
        /* ignore */
      }
    }

    const names = alternatives.length > 0 ? alternatives : [label];
    const primary = names[0] || r.type;
    const link = examinerLinkForExam(primary);
    out.push({
      label,
      type: r.type,
      examinerUrl: link?.url ?? null,
      examinerLabel: link?.label ?? null,
    });

    for (const alt of names.slice(1)) {
      const altLink = examinerLinkForExam(alt);
      if (altLink && !out.some((e) => e.examinerUrl === altLink.url)) {
        out.push({
          label: alt,
          type: r.type,
          examinerUrl: altLink.url,
          examinerLabel: altLink.label,
        });
      }
    }
  }

  return out;
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
  programAcademicYearId: string
): Promise<ProgramDossier | null> {
  const pay = await prisma.programAcademicYear.findUnique({
    where: { id: programAcademicYearId },
    include: {
      program: { include: { university: true } },
      tuition: true,
      cycles: true,
      requirements: true,
      facts: { where: { superseded: false } },
      sourceDocuments: {
        orderBy: { retrievedAt: "desc" },
        take: 8,
      },
    },
  });
  if (!pay) return null;

  const accessFact = pay.facts.find((f) => f.field === "ACCESS_TYPE");
  const manualAccessFact = pay.facts.find(
    (f) => f.field === "ACCESS_TYPE" && f.sourceType === "MANUAL_VERIFIED"
  );
  const regimeFact = pay.facts.find((f) => f.field === "ADMISSION_REGIME");
  const regime = parseAdmissionRegime(regimeFact?.normalizedValueJson);
  const careerFact = pay.facts.find((f) => f.field === "CAREER_OUTCOMES");
  const exams = examsFromRequirements(pay.requirements);
  const publicPrivate =
    regime?.ownership.value && regime.ownership.value !== "UNKNOWN"
      ? regime.ownership.value
      : resolvePublicPrivate(
          pay.program.university.publicPrivate,
          pay.program.university.name
        );
  const accessMode = resolveDossierAccessMode({
    manualAccessFact: manualAccessFact
      ? parseFactValue(manualAccessFact.normalizedValueJson)
      : null,
    regimeAccess: regime?.access.value,
    accessMode: pay.accessMode,
    accessFact: accessFact ? parseFactValue(accessFact.normalizedValueJson) : null,
    hasAdmissionExam: exams.length > 0,
    publicPrivate,
  });

  const nonEuSeats = regime?.seats.value.nonEu ??
    pay.cycles.map((c) => c.nonEuSeats ?? c.nonEuResidentAbroadSeats).find(
      (n) => typeof n === "number"
    ) ?? null;
  const euSeats = regime?.seats.value.eu ??
    pay.cycles.map((c) => c.euSeats).find((n) => typeof n === "number") ?? null;

  const teachingLanguages =
    parseJsonArray(pay.program.teachingLanguagesJson).length > 0
      ? parseJsonArray(pay.program.teachingLanguagesJson)
      : pay.program.language
        ? [pay.program.language]
        : [];

  const callFacts = pay.facts.filter((f) => f.sourceType === "ADMISSION_CALL");
  const hasCall = callFacts.length > 0;

  const callDoc = pay.sourceDocuments.find((d) => d.sourceType === "ADMISSION_CALL");
  const admissionCallUrl =
    callFacts.find((f) => f.sourceUrl)?.sourceUrl ||
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
        pay.program.universitalyUrl,
        ...pay.facts.map((f) => f.sourceUrl).filter(Boolean),
      ].filter(Boolean) as string[]
    ),
  ];

  const career =
    careerFact != null
      ? String(
          parseFactValue(careerFact.normalizedValueJson).text ??
            careerFact.rawValue ??
            ""
        ).trim() || null
      : null;

  // Confirmed programme campus only — never invent from university HQ/name.
  const city = pay.program.campusCity;
  const region =
    pay.program.region || (city ? regionForCity(city) : null);
  const tuition = sanitizeTuitionPair(
    pay.tuition?.minTuition ?? null,
    pay.tuition?.maxTuition ?? null
  );
  const tuitionFixedRaw = pay.tuition?.fixedTuition ?? null;
  const tuitionFixed =
    tuitionFixedRaw != null && (tuitionFixedRaw === 0 || tuitionFixedRaw >= 100)
      ? tuitionFixedRaw
      : null;

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
    languageRequirement: languageRequirementFromRequirements(pay.requirements),
    accessMode,
    selection: resolveDossierSelection({
      regimeSelection: regime?.selection.value,
      accessMode,
      hasAdmissionExam: exams.length > 0,
    }),
    examsDisplay: examsDisplayLabel(exams),
    tuitionMin: tuition.min,
    tuitionMax: tuition.max,
    tuitionFixed,
    deadlines: pay.cycles.map((c) => ({
      roundName: c.roundName,
      deadline: c.applicationDeadline,
    })),
    euSeats,
    nonEuSeats,
    seatsUnlimited: deriveSeatsUnlimited({
      accessMode,
      regimeUnlimited: regime?.seats.value.unlimited,
      euSeats,
      nonEuSeats,
      totalSeats: regime?.seats.value.total ??
        pay.cycles.map((c) => c.totalSeats).find((n) => typeof n === "number") ??
        null,
    }),
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
    languageRequirement: languageRequirementFromRequirements(pay.requirements),
    tuitionMin: tuition.min,
    tuitionMax: tuition.max,
    tuitionFixed,
    accessMode,
    selection: resolveDossierSelection({
      regimeSelection: regime?.selection.value,
      accessMode,
      hasAdmissionExam: exams.length > 0,
    }),
    euSeats,
    nonEuSeats,
    seatsUnlimited: deriveSeatsUnlimited({
      accessMode,
      regimeUnlimited: regime?.seats.value.unlimited,
      euSeats,
      nonEuSeats,
      totalSeats: regime?.seats.value.total ??
        pay.cycles.map((c) => c.totalSeats).find((n) => typeof n === "number") ??
        null,
    }),
    exams,
    examsDisplay: examsDisplayLabel(exams),
    deadlines: pay.cycles.map((c) => ({
      roundName: c.roundName,
      deadline: c.applicationDeadline,
    })),
    careerOutcomes: career,
    callFreshness: deriveCallFreshness({
      academicYear: pay.academicYear,
      indicativeFromYear: pay.indicativeFromYear,
      hasAdmissionCallFact: hasCall,
    }),
    indicativeFromYear: pay.indicativeFromYear,
    academicYear: pay.academicYear,
    dataConfidence: pay.dataConfidence,
    dossierEnrichedAt: pay.dossierEnrichedAt,
    officialUrl: pay.program.officialUrl,
    admissionCallUrl,
    extractQuality,
    sourceUrls,
    isFresh: isDossierTimestampFresh(pay.dossierEnrichedAt),
    fieldStatuses,
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

/**
 * For each PAY: reuse shared dossier if fresh, otherwise AI-enrich (when enabled)
 * or deep-enrich from official URL (regex/PDF fallback).
 */
export async function ensureProgramDossiers(
  programAcademicYearIds: string[],
  options?: EnsureDossiersOptions
): Promise<EnsureDossierResult[]> {
  const { deepEnrichProgram } = await import(
    "@/server/services/program-ingestion/program-deep-enrich"
  );
  const {
    isProgramEnrichmentEnabled,
    enrichProgramWithAi,
  } = await import("@/server/services/program-enrichment");
  const results: EnsureDossierResult[] = [];
  const unique = [...new Set(programAcademicYearIds)];
  const aiOn = isProgramEnrichmentEnabled();
  let done = 0;

  for (const id of unique) {
    if (await isProgramDossierFresh(id)) {
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
      // Fall through to regex/PDF parser
      const enriched = await deepEnrichProgram(id);
      results.push({
        programAcademicYearId: id,
        reused: false,
        enriched: enriched.ok,
        aiStatus: `${ai.status}+FALLBACK_REGEX`,
        reason: enriched.reason ?? ai.error,
      });
      done += 1;
      options?.onProgress?.(done, unique.length, `Fallback ${done}/${unique.length}`);
      continue;
    }

    const enriched = await deepEnrichProgram(id);
    results.push({
      programAcademicYearId: id,
      reused: false,
      enriched: enriched.ok,
      reason: enriched.reason,
      aiStatus: aiOn ? "NO_CONTEXT" : "DISABLED",
    });
    done += 1;
    options?.onProgress?.(done, unique.length, `Обогащение ${done}/${unique.length}`);
  }

  return results;
}
