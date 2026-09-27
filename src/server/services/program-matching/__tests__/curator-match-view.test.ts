import { describe, expect, it } from "vitest";
import {
  buildCuratorMatchView,
  type CuratorMatchFact,
  type CuratorMatchSource,
} from "@/server/services/program-matching/curator-match-view";

function fact(overrides: Partial<CuratorMatchFact> = {}): CuratorMatchFact {
  return {
    field: "TUITION",
    decisionStatus: "ELIGIBLE",
    freshness: "CURRENT",
    superseded: false,
    sourceUrl: "https://example.edu/call",
    evidenceQuote: "quota",
    ...overrides,
  };
}

function source(
  overrides: {
    match?: Partial<CuratorMatchSource>;
    program?: Partial<CuratorMatchSource["programAcademicYear"]["program"]>;
    pay?: Partial<CuratorMatchSource["programAcademicYear"]>;
    university?: Partial<
      CuratorMatchSource["programAcademicYear"]["program"]["university"]
    >;
  } = {}
): CuratorMatchSource {
  return {
    id: "match-1",
    eligibilityStatus: "ELIGIBLE",
    fitScore: 80,
    dataConfidence: "HIGH",
    curatorStatus: "AUTO_MATCHED",
    reasonsJson: null,
    risksJson: null,
    missingInformationJson: null,
    requirementsSummaryJson: null,
    scoreBreakdownJson: null,
    discoveryMetaJson: null,
    monitoringSelected: false,
    ...overrides.match,
    programAcademicYear: {
      id: "pay-1",
      academicYear: "2026/27",
      indicativeFromYear: null,
      facts: [],
      enrichmentRuns: [],
      ...overrides.pay,
      program: {
        id: "prog-1",
        name: "Ingegneria",
        degreeLevel: "BACHELOR",
        language: "Italian",
        teachingLanguagesJson: null,
        field: "ENGINEERING",
        officialUrl: "https://example.edu/prog",
        universitalyUrl: "https://universitaly.it/prog",
        ...overrides.program,
        university: {
          name: "UniBo",
          city: "Bologna",
          publicPrivate: "PUBLIC",
          ...overrides.university,
        },
      },
    },
  };
}

function view(match: CuratorMatchSource, applicationId?: string) {
  return buildCuratorMatchView({
    match,
    dossier: null,
    applicantCategory: "NON_EU",
    applicationId,
    studentId: "student-1",
    intake: "2027/28",
  });
}

describe("buildCuratorMatchView", () => {
  it("falls back when stored match JSON is missing or invalid", () => {
    const built = view(
      source({
        match: {
          reasonsJson: "{",
          risksJson: "null",
          missingInformationJson: null,
          requirementsSummaryJson: "{",
          scoreBreakdownJson: "[",
          discoveryMetaJson: "{",
        },
        program: { teachingLanguagesJson: "{" },
      })
    );

    expect(built.reasons).toEqual([]);
    expect(built.risks).toEqual([]);
    expect(built.riskNotes).toEqual([]);
    expect(built.missingInformation).toEqual([]);
    expect(built.requirements).toEqual([]);
    expect(built.scoreBreakdown).toBeNull();
    expect(built.whyIncluded).toBeNull();
    expect(built.inclusionKind).toBeNull();
    expect(built.teachingLanguages).toEqual(["Italian"]);
  });

  it("keeps parsed match text and a non-array language list as empty", () => {
    const built = view(
      source({
        match: {
          reasonsJson: JSON.stringify(["city fit"]),
          risksJson: JSON.stringify({ flags: ["quota"], notes: ["check"] }),
          scoreBreakdownJson: JSON.stringify({ field: 2 }),
          discoveryMetaJson: JSON.stringify({
            whyIncluded: "field",
            inclusion: { kind: "DIRECTION" },
          }),
        },
        program: { teachingLanguagesJson: JSON.stringify({ en: true }) },
      })
    );

    expect(built.reasons).toEqual(["city fit"]);
    expect(built.risks).toEqual(["quota"]);
    expect(built.riskNotes).toEqual(["check"]);
    expect(built.scoreBreakdown).toEqual({ field: 2 });
    expect(built.whyIncluded).toBe("field");
    expect(built.inclusionKind).toBe("DIRECTION");
    expect(built.teachingLanguages).toEqual([]);
  });

  it("marks source and selection only for current eligible facts", () => {
    const unresolved = view(
      source({
        pay: {
          facts: [
            fact({
              field: "PROGRAMME_SOURCE_RESOLUTION",
              superseded: true,
            }),
            fact({ field: "SEATS", evidenceQuote: null }),
            fact({ field: "TUITION" }),
          ],
        },
      })
    );
    expect(unresolved.sourceResolved).toBe(false);
    expect(unresolved.selectionReady).toBe(false);

    const ready = view(
      source({
        pay: {
          facts: [
            fact({ field: "PROGRAMME_SOURCE_RESOLUTION", sourceUrl: null }),
            fact({ field: "APPLICATION_DEADLINE" }),
          ],
        },
      })
    );
    expect(ready.sourceResolved).toBe(true);
    expect(ready.selectionReady).toBe(true);
  });

  it("summarizes enrichment and leaves tuition unread until a dossier exists", () => {
    const finished = new Date("2026-03-01T00:00:00.000Z");
    const built = view(
      source({
        pay: {
          indicativeFromYear: "2025/26",
          enrichmentRuns: [
            {
              finishedAt: finished,
              model: "gpt-test",
              status: "REUSED",
              sourceDocumentIdsJson: JSON.stringify(["a", "b"]),
              promptVersion: "v1",
            },
          ],
        },
        university: { publicPrivate: null },
      }),
      "app-1"
    );

    expect(built.callFreshness).toBe("indicative");
    expect(built.city).toBeNull();
    expect(built.universityCity).toBe("Bologna");
    expect(built.tuitionMin).toBeNull();
    expect(built.accessMode).toBe("UNKNOWN");
    expect(built.publicPrivate).toBe("UNKNOWN");
    expect(built.alreadyApplied).toBe(true);
    expect(built.applicationId).toBe("app-1");
    expect(built.sourceUrls).toEqual([
      "https://example.edu/prog",
      "https://universitaly.it/prog",
    ]);
    expect(built.aiEnrichment).toMatchObject({
      date: finished.toISOString(),
      model: "gpt-test",
      reused: true,
      documentCount: 2,
      promptVersion: "v1",
      disabled: false,
      failed: false,
    });
  });

  it("disables enrichment when no run exists and ignores a bad document list", () => {
    const missing = view(source());
    expect(missing.aiEnrichment).toEqual({
      date: null,
      model: null,
      reused: false,
      documentCount: 0,
      disabled: true,
      failed: false,
    });
    expect(missing.applicantCategory).toBe("NON_EU");
    expect(missing.alreadyApplied).toBe(false);

    const failed = view(
      source({
        pay: {
          enrichmentRuns: [
            {
              finishedAt: null,
              model: null,
              status: "FAILED",
              sourceDocumentIdsJson: "{",
              promptVersion: "v1",
            },
          ],
        },
      })
    );
    expect(failed.aiEnrichment).toMatchObject({
      documentCount: 0,
      reused: false,
      failed: true,
      disabled: false,
    });
  });
});
