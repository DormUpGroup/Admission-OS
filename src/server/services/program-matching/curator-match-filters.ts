import type { CuratorMatchView } from "@/components/curator-program-match-card";
import type { ProgramDossier } from "@/server/services/program-matching/program-dossier";

export type CuratorMatchFilters = {
  eligibility?: string;
  confidence?: string;
  curator?: string;
  city?: string;
  language?: string;
  publicPrivate?: string;
  accessMode?: string;
  hasExam?: string;
  callFreshness?: string;
};

export function applyCuratorMatchFilters(
  views: CuratorMatchView[],
  filters: CuratorMatchFilters
): CuratorMatchView[] {
  let out = views;

  if (filters.eligibility) {
    out = out.filter((m) => m.eligibilityStatus === filters.eligibility);
  }
  if (filters.confidence) {
    out = out.filter((m) => m.dataConfidence === filters.confidence);
  }
  if (filters.curator) {
    out = out.filter((m) => m.curatorStatus === filters.curator);
  }
  if (filters.city) {
    const q = filters.city.toLowerCase();
    out = out.filter((m) => (m.city || "").toLowerCase().includes(q));
  }
  if (filters.language) {
    const q = filters.language.toLowerCase();
    out = out.filter(
      (m) =>
        (m.language || "").toLowerCase().includes(q) ||
        m.teachingLanguages.some((l) => l.toLowerCase().includes(q))
    );
  }
  if (filters.publicPrivate) {
    out = out.filter(
      (m) =>
        (m.publicPrivate || "UNKNOWN").toUpperCase() ===
        filters.publicPrivate!.toUpperCase()
    );
  }
  if (filters.accessMode) {
    out = out.filter(
      (m) =>
        (m.accessMode || "UNKNOWN").toUpperCase() ===
        filters.accessMode!.toUpperCase()
    );
  }
  if (filters.hasExam) {
    const exam = filters.hasExam.toUpperCase();
    if (exam === "NONE") {
      out = out.filter((m) => m.exams.length === 0);
    } else if (exam === "ANY") {
      out = out.filter((m) => m.exams.length > 0);
    } else {
      out = out.filter((m) =>
        m.exams.some(
          (e) =>
            e.type.toUpperCase().includes(exam) ||
            e.label.toUpperCase().includes(exam)
        )
      );
    }
  }
  if (filters.callFreshness) {
    out = out.filter((m) => m.callFreshness === filters.callFreshness);
  }
  return out;
}

export function mergeDossierIntoCuratorView(
  base: CuratorMatchView,
  dossier: ProgramDossier | null
): CuratorMatchView {
  if (!dossier) return base;
  return {
    ...base,
    city: dossier.city,
    region: dossier.region,
    universityName: dossier.universityName || base.universityName,
    publicPrivate: dossier.publicPrivate,
    programName: dossier.programName || base.programName,
    teachingLanguages: dossier.teachingLanguages,
    language: dossier.teachingLanguages[0] ?? base.language,
    languageRequirement: dossier.languageRequirement,
    tuitionMin: dossier.tuitionMin,
    tuitionMax: dossier.tuitionMax,
    tuitionFixed: dossier.tuitionFixed,
    accessMode: dossier.accessMode,
    selection: dossier.selection,
    euSeats: dossier.euSeats,
    nonEuSeats: dossier.nonEuSeats,
    quotaSeats: dossier.quotaSeats,
    quotaScope: dossier.quotaScope,
    seatsUnlimited: dossier.seatsUnlimited,
    exams: dossier.exams,
    examsDisplay: dossier.examsDisplay,
    careerOutcomes: dossier.careerOutcomes,
    callFreshness: dossier.callFreshness,
    indicativeFromYear: dossier.indicativeFromYear,
    deadline:
      dossier.deadlines.find((d) => d.deadline)?.deadline ?? null,
    admissionCallUrl: dossier.admissionCallUrl,
    extractQuality: dossier.extractQuality,
    sourceUrls:
      dossier.sourceUrls.length > 0 ? dossier.sourceUrls : base.sourceUrls,
    fieldStatuses: dossier.fieldStatuses ?? base.fieldStatuses,
    criticalFacts: dossier.criticalFacts,
  };
}
