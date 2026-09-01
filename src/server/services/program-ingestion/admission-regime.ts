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
  const exams = (input.exams ?? []).filter((exam) => ADMISSION_EXAM.test(exam.name));
  const hasGate = input.admissionGate === true && exams.length > 0;
  let access = input.access ?? "UNKNOWN";
  let selection: SelectionRegime = "UNKNOWN";

  if (hasGate) {
    access = "CLOSED";
    selection = "ENTRANCE_EXAM";
  } else if (input.evaluationOnly) {
    selection = "EVALUATION";
  } else if (access === "OPEN") {
    selection = "NONE";
  } else if (access === "CLOSED" && exams.length > 0) {
    selection = "ENTRANCE_EXAM";
  }

  // "Libero" in the catalogue describes ministerial access, not necessarily
  // private-university selection. Require an explicit no-selection source.
  if (input.ownership === "PRIVATE" && access === "OPEN" && exams.length > 0) {
    access = "CLOSED";
    selection = hasGate ? "ENTRANCE_EXAM" : "UNKNOWN";
  } else if (input.ownership === "PRIVATE" && access === "OPEN") {
    access = "UNKNOWN";
    selection = "UNKNOWN";
  }

  const unlimited = access === "OPEN" && input.totalSeats == null;
  return {
    access: value(access, input, {
      snippet: input.accessSnippet,
      confidence: input.accessConfidence,
    }),
    selection: value(selection, input, {
      snippet: input.examsSnippet ?? input.accessSnippet,
      confidence: hasGate || input.evaluationOnly ? input.examsConfidence ?? "MEDIUM" : input.accessConfidence,
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
  return {
    access: chooseKnown(parts.map((p) => p.access), "UNKNOWN", (v) => v !== "UNKNOWN"),
    selection: chooseKnown(parts.map((p) => p.selection), "UNKNOWN", (v) => v !== "UNKNOWN"),
    admissionExams: chooseKnown(parts.map((p) => p.admissionExams), [], (v) => v.length > 0),
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
