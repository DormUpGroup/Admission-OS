import { describe, expect, it, vi, beforeEach } from "vitest";
import { createFakeEnrichmentClient } from "../openai-client";
import { createFakeOfficialSiteNavigator } from "../official-site-navigator";
import {
  isUsableEnrichmentOutput,
  runLunaTerraEnrichment,
} from "../luna-terra";
import { UNIBO_FIXTURE_PAGES } from "./fixtures/unibo";
import { extractFromHtml } from "../html-extract";
import type { MinimalMatchingContext } from "../matching-context";
import type { EnrichmentOutput } from "../schema";

const emptyOutput = (): EnrichmentOutput => ({
  campuses: [],
  access: [],
  selection: [],
  admissionExams: [],
  languageRequirements: [],
  deadlines: [],
  tuition: [],
  seats: [],
  requiredDocuments: [],
  importantNotes: [],
  sourceConflicts: [],
  unresolvedFields: [],
  siteNavigationSummary: { hops: [], documentsUsed: [] },
});

describe("AI output usefulness", () => {
  it("rejects an empty schema-valid output", () => {
    expect(isUsableEnrichmentOutput(emptyOutput(), true)).toBe(false);
  });

  it("rejects a language-only shortlist output", () => {
    const output = emptyOutput();
    output.languageRequirements = [
      {
        value: { language: "English", level: "B2" },
        sourceDocumentId: "doc-1",
        sourceUrl: "https://example.edu/programme",
        quote: "English language at level B2 is required",
        academicYear: "2026/2027",
        scope: "ALL",
        freshness: "CURRENT",
        confidence: "HIGH",
      },
    ];
    expect(isUsableEnrichmentOutput(output, true)).toBe(false);
  });

  it("accepts a shortlist output with an admission decision fact", () => {
    const output = emptyOutput();
    output.selection = [
      {
        value: "NONE",
        sourceDocumentId: "doc-1",
        sourceUrl: "https://example.edu/programme",
        quote: "The programme has no admission test",
        academicYear: "2026/2027",
        scope: "ALL",
        freshness: "CURRENT",
        confidence: "HIGH",
      },
    ];
    expect(isUsableEnrichmentOutput(output, true)).toBe(true);
  });
});

describe("shared cache / fake client call counting", () => {
  it("fake client increments callCount per completion", async () => {
    const enrolText = extractFromHtml(
      UNIBO_FIXTURE_PAGES.enrol.html,
      UNIBO_FIXTURE_PAGES.enrol.url
    ).cleanText;

    const satJson = JSON.stringify({
      campuses: [
        {
          value: { city: "Bologna" },
          sourceDocumentId: "doc-unibo-root",
          sourceUrl: UNIBO_FIXTURE_PAGES.root.url,
          quote: "The programme is taught in Bologna on the University campus",
          academicYear: "2026/2027",
          scope: "ALL",
          freshness: "CURRENT",
          confidence: "HIGH",
        },
      ],
      access: [],
      selection: [],
      admissionExams: [
        {
          value: "SAT",
          sourceDocumentId: "doc-unibo-enrol",
          sourceUrl: UNIBO_FIXTURE_PAGES.enrol.url,
          quote:
            "Non-EU applicants residing abroad must take the SAT as entrance exam for admission",
          academicYear: "2026/2027",
          scope: "NON_EU_RESIDENT_ABROAD",
          freshness: "CURRENT",
          confidence: "HIGH",
        },
      ],
      languageRequirements: [],
      deadlines: [],
      tuition: [],
      seats: [],
      requiredDocuments: [],
      importantNotes: [],
      sourceConflicts: [],
      unresolvedFields: [],
      siteNavigationSummary: {
        hops: ["root", "enrol"],
        documentsUsed: ["doc-unibo-root", "doc-unibo-enrol"],
      },
    });

    const client = createFakeEnrichmentClient([
      {
        content: null,
        tool_calls: [
          {
            id: "1",
            name: "inspect_programme_site",
            arguments: JSON.stringify({
              officialUrl: UNIBO_FIXTURE_PAGES.root.url,
            }),
          },
        ],
      },
      {
        content: null,
        tool_calls: [
          {
            id: "2",
            name: "follow_official_link",
            arguments: JSON.stringify({ linkId: "L1" }),
          },
        ],
      },
      {
        content: satJson,
        tool_calls: [],
      },
    ]);

    const nav = createFakeOfficialSiteNavigator({
      pages: {
        root: UNIBO_FIXTURE_PAGES.root,
        enrol: UNIBO_FIXTURE_PAGES.enrol,
      },
    });

    const ctx: MinimalMatchingContext = {
      targetAcademicYear: "2026/2027",
      degreeLevel: "BACHELOR",
      applicantCategory: "NON_EU_RESIDENT_ABROAD",
      directions: ["Economics"],
      miurCodes: [],
      preferredTeachingLanguages: ["English"],
      preferredCities: [],
      excludedCities: [],
      maxTuition: null,
      program: {
        name: "Business and Economics",
        universityName: "University of Bologna",
        degreeClass: "L-18",
        language: "English",
        durationYears: 3,
        campusCity: null,
        officialUrl: UNIBO_FIXTURE_PAGES.root.url,
      },
    };

    // Force escalation off for deterministic single-model path
    vi.stubEnv("OPENAI_PROGRAM_ENRICHMENT_ESCALATION_ENABLED", "false");

    const result = await runLunaTerraEnrichment({
      ctx,
      navigator: nav,
      client,
      forShortlist: false,
    });

    expect(client.callCount).toBe(3);
    expect(result.output?.admissionExams[0]?.value).toBe("SAT");
    expect(result.output?.admissionExams[0]?.scope).toBe(
      "NON_EU_RESIDENT_ABROAD"
    );
    expect(result.quoteRejectCount).toBe(0);
    void enrolText;

    vi.unstubAllEnvs();
  });

  it("forces a final JSON answer when the tool budget is exhausted", async () => {
    vi.stubEnv("OPENAI_PROGRAM_ENRICHMENT_ESCALATION_ENABLED", "false");
    vi.stubEnv("OPENAI_PROGRAM_ENRICHMENT_MAX_TOOL_CALLS", "1");

    const officialUrl = "https://example.edu/programme";
    const quote = "No admission test is required";
    const finalJson = JSON.stringify({
      campuses: [],
      access: [],
      selection: [
        {
          value: "NONE",
          sourceDocumentId: "doc-root",
          sourceUrl: officialUrl,
          quote,
          academicYear: "2026/2027",
          scope: "ALL",
          freshness: "CURRENT",
          confidence: "HIGH",
        },
      ],
      admissionExams: [],
      languageRequirements: [],
      deadlines: [],
      tuition: [],
      seats: [],
      requiredDocuments: [],
      importantNotes: [],
      sourceConflicts: [],
      unresolvedFields: ["admissionExams"],
      siteNavigationSummary: {
        hops: ["root"],
        documentsUsed: ["doc-root"],
      },
    });
    const client = createFakeEnrichmentClient([
      {
        content: null,
        tool_calls: [
          {
            id: "1",
            name: "inspect_programme_site",
            arguments: JSON.stringify({ officialUrl }),
          },
        ],
      },
      (req) => {
        expect(req.tool_choice).toBe("none");
        expect(req.tools).toBeUndefined();
        expect(req.messages.at(-1)?.content).toContain("doc-root");
        return { content: finalJson, tool_calls: [] };
      },
    ]);
    const nav = createFakeOfficialSiteNavigator({
      pages: {
        root: {
          url: officialUrl,
          sourceDocumentId: "doc-root",
          html: `<html><body><p>${quote}</p></body></html>`,
        },
      },
    });
    const ctx: MinimalMatchingContext = {
      targetAcademicYear: "2026/2027",
      degreeLevel: "BACHELOR",
      applicantCategory: "NON_EU_RESIDENT_ABROAD",
      directions: ["Economics"],
      miurCodes: [],
      preferredTeachingLanguages: ["English"],
      preferredCities: [],
      excludedCities: [],
      maxTuition: null,
      program: {
        name: "Open Programme",
        universityName: "Example University",
        degreeClass: "L-18",
        language: "English",
        durationYears: 3,
        campusCity: null,
        officialUrl,
      },
    };

    const result = await runLunaTerraEnrichment({
      ctx,
      navigator: nav,
      client,
      forShortlist: true,
    });

    expect(result.output?.selection[0]?.value).toBe("NONE");
    expect(client.callCount).toBe(2);
    vi.unstubAllEnvs();
  });
});

describe("enrichment disabled flag", () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
  });

  it("isProgramEnrichmentEnabled is false without key", async () => {
    vi.stubEnv("OPENAI_API_KEY", "");
    vi.stubEnv("OPENAI_PROGRAM_ENRICHMENT_ENABLED", "true");
    const { isProgramEnrichmentEnabled } = await import("../config");
    expect(isProgramEnrichmentEnabled()).toBe(false);
    vi.unstubAllEnvs();
  });
});
