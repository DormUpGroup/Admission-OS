import {
  DEFAULT_TARGET_ACADEMIC_YEAR,
  PARSER_VERSION,
} from "@/lib/program-matching/config";
import {
  buildEmptyFieldStatusMap,
  isPreviousAcademicYear,
  type CriticalProgramField,
  type FieldUnknownReason,
  type ProgramFieldStatus,
  type ProgramFieldStatusMap,
} from "@/lib/program-matching/field-status";
import type { CallTextParse } from "@/server/services/program-ingestion/call-text-parse";
import type { CallFreshness } from "@/server/services/program-matching/program-dossier";

export type DossierFieldSnapshot = {
  teachingLanguages: string[];
  languageRequirement: string | null;
  accessMode: string;
  selection: string;
  examsDisplay: string | null;
  tuitionMin: number | null;
  tuitionMax: number | null;
  tuitionFixed: number | null;
  deadlines: Array<{ roundName: string; deadline: Date | null }>;
  euSeats: number | null;
  nonEuSeats: number | null;
  seatsUnlimited: boolean;
  callFreshness: CallFreshness;
  academicYear: string;
  officialUrl: string | null;
  admissionCallUrl: string | null;
  extractQuality: string | null;
};

export type EnrichmentDocumentTrace = {
  url: string;
  sourceType: string;
  academicYear: string | null;
  extractionQuality: string | null;
  parserVersion: string | null;
  parseQuality: string;
  body: string;
  isPdf: boolean;
  ocrAttempted: boolean;
  ocrSucceeded: boolean;
  fetchOk: boolean;
};

export type EnrichmentTrace = {
  officialUrl: string | null;
  targetIntakeYear: string;
  payAcademicYear: string;
  fetchFailed: boolean;
  enrichFailed: boolean;
  enrichFailureReason: string | null;
  hasAdmissionCallDocument: boolean;
  documents: EnrichmentDocumentTrace[];
  parsed: CallTextParse | null;
  falseSourceRejections: number;
  ocrSuccessCount: number;
  ocrFailureCount: number;
  manualVerifiedFields: CriticalProgramField[];
};

function withStatus<T>(
  base: ProgramFieldStatus<unknown>,
  patch: Partial<ProgramFieldStatus<T>>
): ProgramFieldStatus<T> {
  return { ...base, ...patch } as ProgramFieldStatus<T>;
}

function bestDocument(
  trace: EnrichmentTrace,
  preferAdmissionCall = false
): EnrichmentDocumentTrace | null {
  // ENRICHMENT_TRACE rows created before document tracing was introduced do
  // not contain this property. Treat them as having no traced documents.
  const documents = Array.isArray(trace.documents) ? trace.documents : [];
  if (documents.length === 0) return null;
  const ordered = [...documents].sort((a, b) => {
    if (preferAdmissionCall) {
      const aCall = a.sourceType === "ADMISSION_CALL" ? 1 : 0;
      const bCall = b.sourceType === "ADMISSION_CALL" ? 1 : 0;
      if (aCall !== bCall) return bCall - aCall;
    }
    return 0;
  });
  return ordered[0] ?? null;
}

function fieldAbsentReason(
  trace: EnrichmentTrace,
  field: CriticalProgramField,
  doc: EnrichmentDocumentTrace | null
): FieldUnknownReason {
  if (!trace.officialUrl) return "OFFICIAL_SOURCE_NOT_FOUND";
  if (trace.fetchFailed) return "SOURCE_FETCH_FAILED";
  if (
    doc?.isPdf &&
    (doc.extractionQuality === "NEEDS_REVIEW" ||
      doc.extractionQuality === "LOW_EXTRACTION_QUALITY" ||
      doc.parseQuality === "EMPTY") &&
    !doc.ocrSucceeded
  ) {
    return "SCANNED_PDF_NEEDS_OCR";
  }
  if (
    field === "admissionCall" ||
    field === "deadline" ||
    field === "seats" ||
    field === "tuition"
  ) {
    if (isPreviousAcademicYear(trace.payAcademicYear, trace.targetIntakeYear)) {
      if (field === "admissionCall" || field === "deadline") {
        return "NOT_PUBLISHED_FOR_TARGET_YEAR";
      }
      return "ONLY_PREVIOUS_YEAR_AVAILABLE";
    }
    if (!trace.hasAdmissionCallDocument && (field === "admissionCall" || field === "deadline")) {
      return "NOT_PUBLISHED_FOR_TARGET_YEAR";
    }
  }
  if (doc && doc.fetchOk && doc.parseQuality !== "EMPTY") {
    return "OFFICIAL_SOURCE_DOES_NOT_STATE_FIELD";
  }
  if (trace.enrichFailed && trace.enrichFailureReason === "no_official_url") {
    return "OFFICIAL_SOURCE_NOT_FOUND";
  }
  if (trace.enrichFailed && trace.enrichFailureReason === "fetch_failed") {
    return "SOURCE_FETCH_FAILED";
  }
  return "OFFICIAL_SOURCE_DOES_NOT_STATE_FIELD";
}

function docMeta(doc: EnrichmentDocumentTrace | null) {
  return {
    sourceUrl: doc?.url ?? null,
    sourceAcademicYear: doc?.academicYear ?? null,
    sourceType: doc?.sourceType ?? null,
    extractionQuality: doc?.extractionQuality ?? null,
    parserVersion: doc?.parserVersion ?? PARSER_VERSION,
  };
}

function freshnessForYear(
  sourceYear: string | null | undefined,
  targetIntakeYear: string
): "current" | "indicative" | null {
  if (!sourceYear) return null;
  if (isPreviousAcademicYear(sourceYear, targetIntakeYear)) return "indicative";
  return "current";
}

/** Previous-year facts stay visible but must never look like current-year rules. */
function previousYearMark(
  freshness: "current" | "indicative" | null,
  sourceYear: string | null | undefined,
  targetIntakeYear: string
): FieldUnknownReason | null {
  if (
    freshness === "indicative" ||
    isPreviousAcademicYear(sourceYear, targetIntakeYear)
  ) {
    return "ONLY_PREVIOUS_YEAR_AVAILABLE";
  }
  return null;
}

export function buildFieldStatusesFromDossier(input: {
  dossier: DossierFieldSnapshot;
  trace: EnrichmentTrace;
  fieldStatusFact?: ProgramFieldStatusMap | null;
}): ProgramFieldStatusMap {
  const { dossier, trace } = input;
  const targetIntakeYear = trace.targetIntakeYear || DEFAULT_TARGET_ACADEMIC_YEAR;
  const base = buildEmptyFieldStatusMap(targetIntakeYear);
  const programmeDoc =
    bestDocument(trace, false) ??
    (dossier.officialUrl
      ? ({
          url: dossier.officialUrl,
          sourceType: "PROGRAMME_PAGE",
          academicYear: dossier.academicYear,
          extractionQuality: dossier.extractQuality,
          parserVersion: PARSER_VERSION,
          parseQuality: "OK",
          body: "",
          isPdf: false,
          ocrAttempted: false,
          ocrSucceeded: false,
          fetchOk: true,
        } satisfies EnrichmentDocumentTrace)
      : null);
  const callDoc = bestDocument(trace, true);
  const sourceYear = dossier.academicYear;
  const freshness =
    dossier.callFreshness === "indicative"
      ? "indicative"
      : freshnessForYear(sourceYear, targetIntakeYear);
  const prevMark = previousYearMark(freshness, sourceYear, targetIntakeYear);
  const fieldFreshness: "current" | "indicative" | null =
    prevMark ? "indicative" : freshness;

  const manualVerifiedFields = Array.isArray(trace.manualVerifiedFields)
    ? trace.manualVerifiedFields
    : [];
  if (manualVerifiedFields.length > 0 && input.fieldStatusFact) {
    for (const field of manualVerifiedFields) {
      if (input.fieldStatusFact[field]?.value != null) {
        base[field] = {
          ...input.fieldStatusFact[field],
          reason: null,
          targetIntakeYear,
        };
      }
    }
  }

  // teachingLanguage — catalogue fact; do not tag as previous-year call data
  if (dossier.teachingLanguages.length > 0) {
    base.teachingLanguage = withStatus(base.teachingLanguage, {
      value: dossier.teachingLanguages,
      reason: null,
      ...docMeta(programmeDoc),
      freshness: fieldFreshness,
      scope: "programme",
    });
  } else {
    base.teachingLanguage = withStatus(base.teachingLanguage, {
      reason: fieldAbsentReason(trace, "teachingLanguage", programmeDoc),
      ...docMeta(programmeDoc),
      freshness: fieldFreshness,
    });
  }

  // languageRequirement
  if (dossier.languageRequirement) {
    base.languageRequirement = withStatus(base.languageRequirement, {
      value: dossier.languageRequirement,
      reason: prevMark,
      ...docMeta(programmeDoc),
      freshness: fieldFreshness,
      scope: "programme",
    });
  } else {
    base.languageRequirement = withStatus(base.languageRequirement, {
      reason: fieldAbsentReason(trace, "languageRequirement", programmeDoc),
      ...docMeta(programmeDoc),
      freshness: fieldFreshness,
    });
  }

  // access
  if (dossier.accessMode !== "UNKNOWN") {
    base.access = withStatus(base.access, {
      value: dossier.accessMode,
      reason: prevMark,
      ...docMeta(programmeDoc),
      freshness: fieldFreshness,
      scope: "programme",
    });
  } else {
    base.access = withStatus(base.access, {
      reason: fieldAbsentReason(trace, "access", programmeDoc),
      ...docMeta(programmeDoc),
      freshness: fieldFreshness,
    });
  }

  // selection
  if (dossier.selection !== "UNKNOWN") {
    base.selection = withStatus(base.selection, {
      value: dossier.selection,
      reason: prevMark,
      ...docMeta(programmeDoc),
      freshness: fieldFreshness,
      scope: "programme",
    });
  } else {
    base.selection = withStatus(base.selection, {
      reason: fieldAbsentReason(trace, "selection", programmeDoc),
      ...docMeta(programmeDoc),
      freshness: fieldFreshness,
    });
  }

  // exams
  const examsFilled =
    dossier.examsDisplay != null ||
    dossier.selection === "NONE" ||
    dossier.selection === "EVALUATION" ||
    (dossier.accessMode === "OPEN" && dossier.selection === "NONE");
  if (examsFilled) {
    base.exams = withStatus(base.exams, {
      value: {
        display: dossier.examsDisplay,
        selection: dossier.selection,
        filled: true,
      },
      reason: prevMark,
      ...docMeta(programmeDoc),
      freshness: fieldFreshness,
      scope: "programme",
    });
  } else {
    base.exams = withStatus(base.exams, {
      reason: fieldAbsentReason(trace, "exams", programmeDoc),
      ...docMeta(programmeDoc),
      freshness: fieldFreshness,
    });
  }

  // tuition
  const hasTuition =
    dossier.tuitionMin != null ||
    dossier.tuitionMax != null ||
    dossier.tuitionFixed != null;
  if (hasTuition) {
    base.tuition = withStatus(base.tuition, {
      value: {
        min: dossier.tuitionMin,
        max: dossier.tuitionMax,
        fixed: dossier.tuitionFixed,
      },
      reason: prevMark,
      ...docMeta(programmeDoc),
      freshness: fieldFreshness,
      scope: "programme",
    });
  } else {
    base.tuition = withStatus(base.tuition, {
      reason: fieldAbsentReason(trace, "tuition", programmeDoc),
      ...docMeta(programmeDoc),
      freshness: fieldFreshness,
    });
  }

  // deadline — keep previous-year dates visible, marked indicative
  const hasDeadline = dossier.deadlines.some((d) => d.deadline != null);
  if (hasDeadline) {
    base.deadline = withStatus(base.deadline, {
      value: dossier.deadlines
        .filter((d) => d.deadline)
        .map((d) => ({ round: d.roundName, deadline: d.deadline?.toISOString() })),
      reason: prevMark,
      ...docMeta(callDoc ?? programmeDoc),
      freshness: fieldFreshness ?? (prevMark ? "indicative" : "current"),
      scope: "programme",
    });
  } else {
    base.deadline = withStatus(base.deadline, {
      reason: fieldAbsentReason(trace, "deadline", callDoc ?? programmeDoc),
      ...docMeta(callDoc ?? programmeDoc),
      freshness: fieldFreshness,
    });
  }

  // seats
  const hasSeats =
    dossier.seatsUnlimited ||
    dossier.euSeats != null ||
    dossier.nonEuSeats != null;
  if (hasSeats) {
    base.seats = withStatus(base.seats, {
      value: {
        eu: dossier.euSeats,
        nonEu: dossier.nonEuSeats,
        unlimited: dossier.seatsUnlimited,
      },
      reason: prevMark,
      ...docMeta(programmeDoc),
      freshness: fieldFreshness,
      scope: "programme",
    });
  } else {
    base.seats = withStatus(base.seats, {
      reason: fieldAbsentReason(trace, "seats", programmeDoc),
      ...docMeta(programmeDoc),
      freshness: fieldFreshness,
    });
  }

  // admissionCall
  if (dossier.admissionCallUrl) {
    base.admissionCall = withStatus(base.admissionCall, {
      value: {
        url: dossier.admissionCallUrl,
        freshness: fieldFreshness ?? dossier.callFreshness,
      },
      reason: prevMark,
      sourceUrl: dossier.admissionCallUrl,
      sourceAcademicYear: sourceYear,
      sourceType: "ADMISSION_CALL",
      extractionQuality: dossier.extractQuality,
      parserVersion: PARSER_VERSION,
      freshness:
        fieldFreshness ??
        (dossier.callFreshness === "unknown" ? null : dossier.callFreshness),
      scope: "programme",
      targetIntakeYear,
    });
  } else if (dossier.officialUrl && dossier.callFreshness === "indicative") {
    base.admissionCall = withStatus(base.admissionCall, {
      value: {
        url: dossier.officialUrl,
        freshness: "indicative",
      },
      reason: "ONLY_PREVIOUS_YEAR_AVAILABLE",
      sourceUrl: dossier.officialUrl,
      sourceAcademicYear: sourceYear,
      sourceType: "PROGRAMME_PAGE",
      extractionQuality: dossier.extractQuality,
      parserVersion: PARSER_VERSION,
      freshness: "indicative",
      scope: "programme",
    });
  } else {
    base.admissionCall = withStatus(base.admissionCall, {
      reason: fieldAbsentReason(trace, "admissionCall", callDoc ?? programmeDoc),
      ...docMeta(callDoc ?? programmeDoc),
      freshness: fieldFreshness,
    });
  }

  return base;
}

export function parseFieldStatusFact(
  raw: string | null | undefined
): ProgramFieldStatusMap | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as ProgramFieldStatusMap;
  } catch {
    return null;
  }
}
