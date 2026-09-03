import { describe, expect, it } from "vitest";
import {
  deriveAccessMode,
  deriveSeatsUnlimited,
  deriveCallFreshness,
  examsDisplayLabel,
  isDossierTimestampFresh,
  canReuseLegacyDossier,
  resolveDossierAccessMode,
  resolveDossierSelection,
  resolvePublicPrivate,
  shouldUseDeterministicDossierFallback,
} from "@/server/services/program-matching/program-dossier";
import {
  formatExamAlternatives,
  examinerLinkForExam,
} from "@/lib/program-matching/examiner-links";
import { applyCuratorMatchFilters } from "@/server/services/program-matching/curator-match-filters";
import type { CuratorMatchView } from "@/components/curator-program-match-card";
import { parseProgrammePageHtml } from "@/server/services/program-ingestion/adapters/university-website";
import { PROGRAM_DOSSIER_TTL_DAYS } from "@/lib/program-matching/config";

describe("dossier cache boundary", () => {
  it("never lets a fresh legacy dossier block enabled AI", () => {
    expect(canReuseLegacyDossier(true, true)).toBe(false);
    expect(canReuseLegacyDossier(false, true)).toBe(true);
  });

  it("uses deterministic fallback only when AI enrichment is disabled", () => {
    expect(shouldUseDeterministicDossierFallback(true)).toBe(false);
    expect(shouldUseDeterministicDossierFallback(false)).toBe(true);
  });
});

describe("dossier freshness", () => {
  it("treats missing timestamp as stale", () => {
    expect(isDossierTimestampFresh(null)).toBe(false);
  });

  it("treats recent enrich as fresh", () => {
    expect(isDossierTimestampFresh(new Date())).toBe(true);
  });

  it("treats old enrich as stale", () => {
    const old = new Date(
      Date.now() - (PROGRAM_DOSSIER_TTL_DAYS + 1) * 24 * 60 * 60 * 1000
    );
    expect(isDossierTimestampFresh(old)).toBe(false);
  });
});

describe("access / call helpers", () => {
  it("derives CLOSED from programmazione text", () => {
    expect(
      deriveAccessMode({
        accessFact: { programmazione: "Numero programmato" },
      })
    ).toBe("CLOSED");
  });

  it("does not treat ministerial libero as open access for private universities", () => {
    expect(
      deriveAccessMode({
        accessMode: "OPEN",
        publicPrivate: "PRIVATE",
      })
    ).toBe("UNKNOWN");
  });

  it("treats admission exams as closed access", () => {
    expect(
      deriveAccessMode({
        accessMode: "OPEN",
        hasAdmissionExam: true,
      })
    ).toBe("CLOSED");
    expect(
      deriveAccessMode({
        accessMode: "UNKNOWN",
        hasAdmissionExam: true,
      })
    ).toBe("CLOSED");
  });

  it("does not let an unknown parsed regime erase catalogue access", () => {
    expect(
      resolveDossierAccessMode({
        regimeAccess: "UNKNOWN",
        accessMode: "OPEN",
        publicPrivate: "PUBLIC",
      })
    ).toBe("OPEN");
    expect(
      resolveDossierSelection({
        regimeSelection: "UNKNOWN",
        accessMode: "OPEN",
        hasAdmissionExam: false,
      })
    ).toBe("NONE");
    expect(
      deriveSeatsUnlimited({ accessMode: "OPEN" })
    ).toBe(true);
  });

  it("keeps catalogue open access conservative for private universities", () => {
    expect(
      resolveDossierAccessMode({
        regimeAccess: "UNKNOWN",
        accessMode: "OPEN",
        publicPrivate: "PRIVATE",
      })
    ).toBe("UNKNOWN");
  });

  it("marks indicative call freshness", () => {
    expect(
      deriveCallFreshness({
        academicYear: "2027/2028",
        indicativeFromYear: "2026/2027",
      })
    ).toBe("indicative");
  });
});

describe("exam formatting", () => {
  it("joins alternatives with или", () => {
    expect(
      formatExamAlternatives([
        { name: "SAT", detail: "≥ 1200" },
        { name: "TOLC-E" },
      ])
    ).toBe("SAT ≥ 1200 или TOLC-E");
  });

  it("does not duplicate SAT after alternatives label", () => {
    expect(
      examsDisplayLabel([
        { label: "TOLC-E или SAT" },
        { label: "SAT" },
      ])
    ).toBe("TOLC-E или SAT");
  });

  it("resolves examiner links", () => {
    expect(examinerLinkForExam("TOLC-E")?.url).toContain("cisiaonline");
    expect(examinerLinkForExam("SAT")?.url).toContain("collegeboard");
  });
});

describe("ownership on the curator card", () => {
  it("corrects Bocconi stored as PUBLIC", () => {
    expect(
      resolvePublicPrivate(
        "PUBLIC",
        'Università Commerciale "Luigi Bocconi" MILANO'
      )
    ).toBe("PRIVATE");
  });
});

describe("HTML programme parse", () => {
  it("extracts language level tuition access and career", () => {
    const html = `
      <html><body>
      <p>Taught in English. English B2 required.</p>
      <p>Tuition from €156 to €3.500 euro per year.</p>
      <p>Accesso a numero programmato. 40 posti non-EU available.</p>
      <p>SAT 1200 or TOLC-E accepted.</p>
      <p>Career opportunities: finance analyst, banking roles worldwide.</p>
      <p>Deadline 15/05/2027</p>
      </body></html>
    `;
    const parsed = parseProgrammePageHtml(html, "https://example.it/corso");
    expect(parsed.languages).toContain("English");
    expect(parsed.languageLevel).toBe("B2");
    expect(parsed.accessMode).toBe("CLOSED");
    expect(parsed.nonEuSeats).toBe(40);
    expect(parsed.examAlternatives.length).toBeGreaterThanOrEqual(2);
    // Career blurbs are best-effort heuristics
    if (parsed.careerOutcomes) {
      expect(parsed.careerOutcomes).toMatch(/finance|banking|analyst/i);
    }
    expect(parsed.deadlines.length).toBeGreaterThan(0);
  });
});

function baseView(over: Partial<CuratorMatchView> = {}): CuratorMatchView {
  return {
    matchId: "m1",
    programId: "p1",
    programAcademicYearId: "pay1",
    programName: "Economics",
    universityName: "Unibo",
    city: "Bologna",
    region: "Emilia-Romagna",
    degreeLevel: "BACHELOR",
    language: "English",
    teachingLanguages: ["English"],
    languageRequirement: "English B2",
    publicPrivate: "PUBLIC",
    field: "Economics",
    academicYear: "2027/2028",
    eligibilityStatus: "ELIGIBLE",
    fitScore: 80,
    dataConfidence: "MEDIUM",
    curatorStatus: "AUTO_MATCHED",
    reasons: [],
    risks: [],
    riskNotes: [],
    missingInformation: [],
    requirements: [],
    deadline: new Date("2027-05-15"),
    tuitionMin: 0,
    tuitionMax: 3000,
    tuitionFixed: null,
    accessMode: "OPEN",
    nonEuSeats: null,
    exams: [{ label: "SAT ≥ 1200", type: "SAT", examinerUrl: null, examinerLabel: null }],
    examsDisplay: "SAT ≥ 1200",
    careerOutcomes: null,
    callFreshness: "unknown",
    indicativeFromYear: null,
    sourceUrls: [],
    alreadyApplied: false,
    studentId: "s1",
    intake: "2027/2028",
    ...over,
  };
}

describe("curator filters", () => {
  it("filters by city language access and exam", () => {
    const views = [
      baseView(),
      baseView({
        matchId: "m2",
        city: "Milano",
        language: "Italian",
        teachingLanguages: ["Italian"],
        accessMode: "CLOSED",
        exams: [],
        examsDisplay: null,
        publicPrivate: "PRIVATE",
      }),
    ];
    expect(applyCuratorMatchFilters(views, { city: "bologna" })).toHaveLength(1);
    expect(applyCuratorMatchFilters(views, { language: "Italian" })).toHaveLength(1);
    expect(applyCuratorMatchFilters(views, { accessMode: "CLOSED" })).toHaveLength(1);
    expect(applyCuratorMatchFilters(views, { hasExam: "NONE" })).toHaveLength(1);
    expect(applyCuratorMatchFilters(views, { hasExam: "SAT" })).toHaveLength(1);
    expect(applyCuratorMatchFilters(views, { publicPrivate: "PRIVATE" })).toHaveLength(1);
  });
});
