import type { CuratorMatchView } from "@/components/curator-program-match-card";
import { mergeDossierIntoCuratorView } from "@/server/services/program-matching/curator-match-filters";
import type { ProgramDossier } from "@/server/services/program-matching/program-dossier";

const SELECTION_READY_FIELDS = [
  "ACCESS_TYPE",
  "ADMISSION_REGIME",
  "SELECTION",
  "ADMISSION_EXAMS",
  "SEATS",
  "APPLICATION_DEADLINE",
] as const;

export type CuratorMatchFact = {
  field: string;
  decisionStatus: string;
  freshness: string | null;
  superseded: boolean;
  sourceUrl: string | null;
  evidenceQuote: string | null;
};

export type CuratorMatchSource = {
  id: string;
  eligibilityStatus: string;
  fitScore: number;
  dataConfidence: string;
  curatorStatus: string;
  reasonsJson: string | null;
  risksJson: string | null;
  missingInformationJson: string | null;
  requirementsSummaryJson: string | null;
  scoreBreakdownJson: string | null;
  discoveryMetaJson: string | null;
  monitoringSelected: boolean | null;
  programAcademicYear: {
    id: string;
    academicYear: string;
    indicativeFromYear: string | null;
    facts: CuratorMatchFact[];
    enrichmentRuns: Array<{
      finishedAt: Date | null;
      model: string | null;
      status: string;
      sourceDocumentIdsJson: string | null;
      promptVersion: string;
    }>;
    program: {
      id: string;
      name: string;
      degreeLevel: string;
      language: string | null;
      teachingLanguagesJson: string | null;
      field: string | null;
      officialUrl: string | null;
      universitalyUrl: string | null;
      university: {
        name: string;
        city: string | null;
        publicPrivate: string | null;
      };
    };
  };
};

export function buildCuratorMatchView(input: {
  match: CuratorMatchSource;
  dossier: ProgramDossier | null;
  applicantCategory?: string;
  applicationId?: string;
  studentId: string;
  intake: string;
}): CuratorMatchView {
  const match = input.match;
  const pay = match.programAcademicYear;
  const program = pay.program;

  let reasons: string[] = [];
  let risks: string[] = [];
  let riskNotes: string[] = [];
  let missingInformation: string[] = [];
  let requirements: Array<{ description: string; status: string }> = [];
  let scoreBreakdown: Record<string, number> | null = null;
  try {
    reasons = match.reasonsJson ? JSON.parse(match.reasonsJson) : [];
  } catch {
    reasons = [];
  }
  try {
    const parsed = match.risksJson ? JSON.parse(match.risksJson) : {};
    risks = parsed.flags || [];
    riskNotes = parsed.notes || [];
  } catch {
    risks = [];
    riskNotes = [];
  }
  try {
    missingInformation = match.missingInformationJson
      ? JSON.parse(match.missingInformationJson)
      : [];
  } catch {
    missingInformation = [];
  }
  try {
    requirements = match.requirementsSummaryJson
      ? JSON.parse(match.requirementsSummaryJson)
      : [];
  } catch {
    requirements = [];
  }
  try {
    scoreBreakdown = match.scoreBreakdownJson
      ? JSON.parse(match.scoreBreakdownJson)
      : null;
  } catch {
    scoreBreakdown = null;
  }
  let whyIncluded: string | null = null;
  let inclusionKind: string | null = null;
  try {
    const meta = match.discoveryMetaJson
      ? (JSON.parse(match.discoveryMetaJson) as {
          whyIncluded?: string;
          inclusion?: { kind?: string };
        })
      : null;
    whyIncluded = meta?.whyIncluded ?? null;
    inclusionKind = meta?.inclusion?.kind ?? null;
  } catch {
    whyIncluded = null;
    inclusionKind = null;
  }

  const teachingLanguages = (() => {
    try {
      const parsed = program.teachingLanguagesJson
        ? JSON.parse(program.teachingLanguagesJson)
        : [];
      return Array.isArray(parsed) ? parsed.map(String) : [];
    } catch {
      return program.language ? [program.language] : [];
    }
  })();

  const base: CuratorMatchView = {
    matchId: match.id,
    programId: program.id,
    programAcademicYearId: pay.id,
    programName: program.name,
    universityName: program.university.name,
    city: null,
    universityCity: program.university.city,
    region: null,
    degreeLevel: program.degreeLevel,
    language: program.language,
    teachingLanguages,
    languageRequirement: null,
    publicPrivate: program.university.publicPrivate || "UNKNOWN",
    field: program.field,
    academicYear: pay.academicYear,
    applicantCategory: input.applicantCategory ?? "UNKNOWN",
    eligibilityStatus: match.eligibilityStatus,
    fitScore: match.fitScore,
    dataConfidence: match.dataConfidence,
    curatorStatus: match.curatorStatus,
    reasons,
    risks,
    riskNotes,
    missingInformation,
    requirements,
    deadline: null,
    tuitionMin: null,
    tuitionMax: null,
    tuitionFixed: null,
    accessMode: "UNKNOWN",
    selection: "UNKNOWN",
    euSeats: null,
    nonEuSeats: null,
    seatsUnlimited: false,
    exams: [],
    examsDisplay: null,
    careerOutcomes: null,
    callFreshness: pay.indicativeFromYear ? "indicative" : "unknown",
    indicativeFromYear: pay.indicativeFromYear,
    admissionCallUrl: null,
    extractQuality: null,
    sourceUrls: [
      ...new Set(
        [
          program.officialUrl,
          program.universitalyUrl,
          ...pay.facts.map((fact) => fact.sourceUrl).filter(Boolean),
        ].filter(Boolean) as string[]
      ),
    ],
    sourceResolved: pay.facts.some(
      (fact) =>
        fact.field === "PROGRAMME_SOURCE_RESOLUTION" &&
        fact.decisionStatus === "ELIGIBLE" &&
        fact.freshness === "CURRENT" &&
        !fact.superseded
    ),
    selectionReady: pay.facts.some(
      (fact) =>
        (SELECTION_READY_FIELDS as readonly string[]).includes(fact.field) &&
        fact.decisionStatus === "ELIGIBLE" &&
        fact.freshness === "CURRENT" &&
        !!fact.sourceUrl &&
        !!fact.evidenceQuote &&
        !fact.superseded
    ),
    alreadyApplied: Boolean(input.applicationId),
    applicationId: input.applicationId,
    studentId: input.studentId,
    intake: input.intake,
    scoreBreakdown,
    whyIncluded,
    inclusionKind,
    monitoringSelected: match.monitoringSelected ?? false,
    campuses: [],
    criticalFacts: [],
    aiEnrichment: summarizeEnrichment(pay.enrichmentRuns[0]),
  };

  return mergeDossierIntoCuratorView(base, input.dossier);
}

function summarizeEnrichment(
  run: CuratorMatchSource["programAcademicYear"]["enrichmentRuns"][number] | undefined
): CuratorMatchView["aiEnrichment"] {
  if (!run) {
    return {
      date: null,
      model: null,
      reused: false,
      documentCount: 0,
      disabled: true,
      failed: false,
    };
  }
  let documentCount = 0;
  try {
    documentCount = run.sourceDocumentIdsJson
      ? (JSON.parse(run.sourceDocumentIdsJson) as unknown[]).length
      : 0;
  } catch {
    documentCount = 0;
  }
  return {
    date: run.finishedAt?.toISOString() ?? null,
    model: run.model,
    reused: run.status === "REUSED",
    documentCount,
    promptVersion: run.promptVersion,
    disabled: false,
    failed: run.status === "FAILED",
  };
}
