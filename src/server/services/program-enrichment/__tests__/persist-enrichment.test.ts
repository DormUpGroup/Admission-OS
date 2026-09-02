import { describe, expect, it, vi, beforeEach } from "vitest";
import { validateEvidenceQuote } from "../quote-validator";
import { persistEnrichmentOutput } from "../persist-enrichment";
import type { EnrichmentOutput } from "../schema";
import { relevantPageFingerprint } from "../html-extract";

const mockFactCreate = vi.fn();
const mockFactFindMany = vi.fn();
const mockFactUpdate = vi.fn();
const mockChangeCreate = vi.fn();
const mockProgramUpdate = vi.fn();

vi.mock("@/lib/db", () => ({
  prisma: {
    programFact: {
      findMany: (...args: unknown[]) => mockFactFindMany(...args),
      create: (...args: unknown[]) => mockFactCreate(...args),
      update: (...args: unknown[]) => mockFactUpdate(...args),
    },
    programChangeEvent: {
      create: (...args: unknown[]) => mockChangeCreate(...args),
    },
    program: {
      update: (...args: unknown[]) => mockProgramUpdate(...args),
    },
  },
}));

describe("persistEnrichmentOutput", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFactFindMany.mockResolvedValue([]);
    mockFactCreate.mockImplementation(async ({ data }: { data: unknown }) => ({
      id: "fact-1",
      ...(data as object),
    }));
    mockProgramUpdate.mockResolvedValue({});
  });

  it("does not save facts with invalid quotes", async () => {
    const output: EnrichmentOutput = {
      campuses: [],
      access: [],
      selection: [],
      admissionExams: [
        {
          value: "SAT",
          sourceDocumentId: "doc1",
          sourceUrl: "https://corsi.unibo.it/x",
          quote: "This quote does not exist in the document at all",
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
      siteNavigationSummary: { hops: [], documentsUsed: [] },
    };

    const result = await persistEnrichmentOutput({
      programId: "p1",
      programAcademicYearId: "pay1",
      academicYear: "2026/2027",
      applicantCategory: "NON_EU_RESIDENT_ABROAD",
      output,
      documentTexts: new Map([["doc1", "Only SAT is mentioned for Non-EU abroad."]]),
      extractionMethod: "OPENAI_test",
    });

    expect(result.quoteRejectCount).toBe(1);
    expect(result.savedFields).toHaveLength(0);
    expect(mockFactCreate).not.toHaveBeenCalled();
  });

  it("does not apply Non-EU facts to EU applicant", async () => {
    const quote = "Non-EU applicants residing abroad must take the SAT";
    const output: EnrichmentOutput = {
      campuses: [],
      access: [],
      selection: [],
      admissionExams: [
        {
          value: "SAT",
          sourceDocumentId: "doc1",
          sourceUrl: "https://corsi.unibo.it/x",
          quote,
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
      siteNavigationSummary: { hops: [], documentsUsed: [] },
    };

    const result = await persistEnrichmentOutput({
      programId: "p1",
      programAcademicYearId: "pay1",
      academicYear: "2026/2027",
      applicantCategory: "EU_CITIZEN",
      output,
      documentTexts: new Map([["doc1", quote + " for admission."]]),
      extractionMethod: "OPENAI_test",
    });

    expect(result.savedFields).toHaveLength(0);
    expect(mockFactCreate).not.toHaveBeenCalled();
  });

  it("never overwrites MANUAL_VERIFIED", async () => {
    mockFactFindMany.mockResolvedValueOnce([
      {
        id: "manual-1",
        verificationStatus: "VERIFIED",
        sourceType: "MANUAL_VERIFIED",
        extractionMethod: "MANUAL",
        normalizedValueJson: '"TOLC"',
      },
    ]);

    const quote = "Deadline is 15 May 2026 for Non-EU applicants";
    const output: EnrichmentOutput = {
      campuses: [],
      access: [],
      selection: [],
      admissionExams: [],
      languageRequirements: [],
      deadlines: [
        {
          value: "2026-05-15",
          sourceDocumentId: "doc1",
          sourceUrl: "https://corsi.unibo.it/x",
          quote,
          academicYear: "2026/2027",
          scope: "ALL",
          freshness: "CURRENT",
          confidence: "HIGH",
        },
      ],
      tuition: [],
      seats: [],
      requiredDocuments: [],
      importantNotes: [],
      sourceConflicts: [],
      unresolvedFields: [],
      siteNavigationSummary: { hops: [], documentsUsed: [] },
    };

    await persistEnrichmentOutput({
      programId: "p1",
      programAcademicYearId: "pay1",
      academicYear: "2026/2027",
      applicantCategory: "NON_EU_RESIDENT_ABROAD",
      output,
      documentTexts: new Map([["doc1", quote]]),
      extractionMethod: "OPENAI_test",
    });

    expect(mockFactCreate).not.toHaveBeenCalled();
    expect(mockFactUpdate).not.toHaveBeenCalled();
  });

  it("saves campus from official quote and updates campusesJson", async () => {
    const quote = "The programme is taught in Bologna on the University campus";
    expect(validateEvidenceQuote(quote, quote + ".")).toMatchObject({
      accepted: true,
    });

    const output: EnrichmentOutput = {
      campuses: [
        {
          value: { city: "Bologna" },
          sourceDocumentId: "doc1",
          sourceUrl: "https://corsi.unibo.it/x",
          quote,
          academicYear: "2026/2027",
          scope: "ALL",
          freshness: "CURRENT",
          confidence: "HIGH",
        },
      ],
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
    };

    const result = await persistEnrichmentOutput({
      programId: "p1",
      programAcademicYearId: "pay1",
      academicYear: "2026/2027",
      applicantCategory: "NON_EU_RESIDENT_ABROAD",
      output,
      documentTexts: new Map([["doc1", quote + "."]]),
      extractionMethod: "OPENAI_test",
    });

    expect(result.campusesUpdated).toBe(true);
    expect(mockProgramUpdate).toHaveBeenCalled();
    const data = mockProgramUpdate.mock.calls[0][0].data;
    expect(data.campusCity).toBe("Bologna");
  });

  it("supersedes old automatic fact and creates change event on value change", async () => {
    mockFactFindMany
      .mockResolvedValueOnce([
        {
          id: "old",
          verificationStatus: "UNVERIFIED",
          sourceType: "PROGRAMME_PAGE",
          extractionMethod: "HTML_HEURISTIC",
          normalizedValueJson: '"2026-04-01"',
        },
      ]) // supersedeAutomaticFact
      .mockResolvedValueOnce([
        {
          id: "old",
          normalizedValueJson: '"2026-04-01"',
          superseded: true,
        },
      ]); // oldFacts for change event

    const quote = "Application deadline: 15 May 2026";
    const output: EnrichmentOutput = {
      campuses: [],
      access: [],
      selection: [],
      admissionExams: [],
      languageRequirements: [],
      deadlines: [
        {
          value: "2026-05-15",
          sourceDocumentId: "doc1",
          sourceUrl: "https://corsi.unibo.it/x",
          quote,
          academicYear: "2026/2027",
          scope: "ALL",
          freshness: "CURRENT",
          confidence: "HIGH",
        },
      ],
      tuition: [],
      seats: [],
      requiredDocuments: [],
      importantNotes: [],
      sourceConflicts: [],
      unresolvedFields: [],
      siteNavigationSummary: { hops: [], documentsUsed: [] },
    };

    await persistEnrichmentOutput({
      programId: "p1",
      programAcademicYearId: "pay1",
      academicYear: "2026/2027",
      applicantCategory: "NON_EU_RESIDENT_ABROAD",
      output,
      documentTexts: new Map([["doc1", quote]]),
      extractionMethod: "OPENAI_test",
    });

    expect(mockFactUpdate).toHaveBeenCalled();
    expect(mockFactCreate).toHaveBeenCalled();
    expect(mockChangeCreate).toHaveBeenCalled();
  });
});

describe("footer noise fingerprint", () => {
  it("treats footer/cookie-only diffs as same relevant fingerprint", () => {
    const a = relevantPageFingerprint(
      "Admission deadline 15 May. Cookie policy Privacy menu footer"
    );
    const b = relevantPageFingerprint(
      "Admission deadline 15 May. Cookie settings updated Privacy menu footer nav"
    );
    expect(a).toBe(b);
  });
});
