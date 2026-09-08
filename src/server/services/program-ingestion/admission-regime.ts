import { SOURCE_PRIORITY } from "@/lib/program-matching/config";

export type RegimeConfidence = "HIGH" | "MEDIUM" | "LOW";
export type AccessRegime = "OPEN" | "CLOSED" | "UNKNOWN";
export type SelectionRegime =
  | "NONE"
  | "EVALUATION"
  | "ENTRANCE_EXAM"
  | "UNKNOWN";
export type OwnershipRegime = "PUBLIC" | "PRIVATE" | "UNKNOWN";

export type Provenanced<T> = {
  value: T;
  sourceUrl: string | null;
  snippet: string | null;
  confidence: RegimeConfidence;
  sourceType: string;
};

export type AdmissionExam = { name: string; detail?: string };

export type AdmissionRegime = {
  access: Provenanced<AccessRegime>;
  selection: Provenanced<SelectionRegime>;
  admissionExams: Provenanced<AdmissionExam[]>;
  languageRequirement: Provenanced<string | null>;
  seats: Provenanced<{
    eu: number | null;
    nonEu: number | null;
    total: number | null;
    unlimited: boolean;
  }>;
  ownership: Provenanced<OwnershipRegime>;
};

export type AdmissionRegimeInput = {
  sourceUrl?: string | null;
  sourceType?: string;
  access?: AccessRegime;
  accessSnippet?: string | null;
  accessConfidence?: RegimeConfidence;
  /** A real admission gate, not a footer mention of a test provider. */
  admissionGate?: boolean;
  evaluationOnly?: boolean;
  exams?: AdmissionExam[];
  examsSnippet?: string | null;
  examsConfidence?: RegimeConfidence;
  languageRequirement?: string | null;
  languageSnippet?: string | null;
  languageConfidence?: RegimeConfidence;
  euSeats?: number | null;
  nonEuSeats?: number | null;
  totalSeats?: number | null;
  seatsSnippet?: string | null;
  seatsConfidence?: RegimeConfidence;
  ownership?: OwnershipRegime;
  ownershipSnippet?: string | null;
  ownershipConfidence?: RegimeConfidence;
};

function value<T>(
  v: T,
  input: AdmissionRegimeInput,
  extra?: { snippet?: string | null; confidence?: RegimeConfidence }
): Provenanced<T> {
  return {
    value: v,
    sourceUrl: input.sourceUrl ?? null,
    snippet: extra?.snippet ?? null,
    confidence: extra?.confidence ?? "LOW",
    sourceType: input.sourceType ?? "OTHER",
  };
}

const ADMISSION_EXAM = /^(SAT|TOLC(?:-[A-Z]+)?|IMAT|ACT|BOCCONI_TEST|ADMISSION_TEST)$/i;

/**
 * Converts one parsed official source into a conservative admission regime.
 * A language certificate never becomes an admission exam; UNKNOWN wins over a
 * guessed OPEN state.
 */
export function inferAdmissionRegime(input: AdmissionRegimeInput): AdmissionRegime {
  let exams = (input.exams ?? []).filter((exam) => ADMISSION_EXAM.test(exam.name));
  const hasNamedExam = exams.length > 0;
  let access = input.access ?? "UNKNOWN";
  let selection: SelectionRegime = "UNKNOWN";

  // Decision invariant, in priority order:
  // 1. A documented open admission is conclusive: no admission exam.
  // 2. A named admission exam is a competitive/closed selection even when
  //    the source omitted an explicit access label.
  // 3. A documented competitive gate remains closed while its exact exam is
  //    investigated; never silently turn it into open admission.
  if (access === "OPEN") {
    exams = [];
    selection = input.evaluationOnly ? "EVALUATION" : "NONE";
  } else if (hasNamedExam) {
    access = "CLOSED";
    selection = "ENTRANCE_EXAM";
  } else if (input.admissionGate) {
    access = "CLOSED";
    selection = "ENTRANCE_EXAM";
  } else if (input.evaluationOnly) {
    selection = "EVALUATION";
  }

  const unlimited = access === "OPEN" && input.totalSeats == null;
  return {
    access: value(access, input, {
      snippet: input.accessSnippet,
      confidence: input.accessConfidence,
    }),
    selection: value(selection, input, {
      snippet: input.examsSnippet ?? input.accessSnippet,
      confidence:
        hasNamedExam || input.admissionGate || input.evaluationOnly
          ? input.examsConfidence ?? "MEDIUM"
          : input.accessConfidence,
    }),
    admissionExams: value(exams, input, {
      snippet: input.examsSnippet,
      confidence: exams.length ? input.examsConfidence ?? "MEDIUM" : "LOW",
    }),
    languageRequirement: value(input.languageRequirement ?? null, input, {
      snippet: input.languageSnippet,
      confidence: input.languageRequirement ? input.languageConfidence ?? "MEDIUM" : "LOW",
    }),
    seats: value(
      {
        eu: input.euSeats ?? null,
        nonEu: input.nonEuSeats ?? null,
        total: input.totalSeats ?? null,
        unlimited,
      },
      input,
      { snippet: input.seatsSnippet, confidence: input.seatsConfidence }
    ),
    ownership: value(input.ownership ?? "UNKNOWN", input, {
      snippet: input.ownershipSnippet,
      confidence: input.ownershipConfidence,
    }),
  };
}

function rank(sourceType: string): number {
  return SOURCE_PRIORITY[sourceType] ?? SOURCE_PRIORITY.OTHER;
}

function choose<T>(items: Array<Provenanced<T>>, unknown: T): Provenanced<T> {
  return [...items].sort((a, b) => rank(b.sourceType) - rank(a.sourceType))[0] ?? {
    value: unknown,
    sourceUrl: null,
    snippet: null,
    confidence: "LOW",
    sourceType: "OTHER",
  };
}

function chooseKnown<T>(
  items: Array<Provenanced<T>>,
  unknown: T,
  known: (value: T) => boolean
): Provenanced<T> {
  return choose(items.filter((item) => known(item.value)), unknown);
}

/** Merge field-by-field: a bando can supply seats while a tasse page supplies fees. */
export function mergeAdmissionRegime(parts: AdmissionRegime[]): AdmissionRegime {
  const access = chooseKnown(
    parts.map((p) => p.access),
    "UNKNOWN",
    (v) => v !== "UNKNOWN"
  );
  const selection = chooseKnown(
    parts.map((p) => p.selection),
    "UNKNOWN",
    (v) => v !== "UNKNOWN"
  );
  const admissionExams = chooseKnown(
    parts.map((p) => p.admissionExams),
    [],
    (v) => v.length > 0
  );
  const forced = <T>(field: Provenanced<unknown>, value: T): Provenanced<T> => ({
    value,
    sourceUrl: field.sourceUrl,
    snippet: field.snippet,
    confidence: field.confidence,
    sourceType: field.sourceType,
  });
  const openAdmission = access.value === "OPEN";
  const hasNamedExam = admissionExams.value.length > 0;
  const competitiveSelection = selection.value === "ENTRANCE_EXAM";

  return {
    access: openAdmission
      ? access
      : hasNamedExam || competitiveSelection
        ? access.value === "UNKNOWN"
          ? forced(admissionExams.value.length > 0 ? admissionExams : selection, "CLOSED")
          : access
        : access,
    selection: openAdmission
      ? selection.value === "EVALUATION"
        ? selection
        : forced(access, "NONE")
      : hasNamedExam
        ? forced(admissionExams, "ENTRANCE_EXAM")
        : selection,
    admissionExams: openAdmission ? forced(access, []) : admissionExams,
    languageRequirement: chooseKnown(parts.map((p) => p.languageRequirement), null, (v) => v != null),
    seats: chooseKnown(parts.map((p) => p.seats), {
      eu: null,
      nonEu: null,
      total: null,
      unlimited: false,
    }, (v) => v.eu != null || v.nonEu != null || v.total != null || v.unlimited),
    ownership: chooseKnown(parts.map((p) => p.ownership), "UNKNOWN", (v) => v !== "UNKNOWN"),
  };
}
