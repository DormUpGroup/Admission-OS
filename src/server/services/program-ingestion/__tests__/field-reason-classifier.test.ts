import { describe, expect, it } from "vitest";
import {
  buildFieldStatusesFromDossier,
  type EnrichmentTrace,
} from "@/server/services/program-ingestion/field-reason-classifier";
import { isFieldExplained, isFieldFilled } from "@/lib/program-matching/field-status";
import { parseCallText } from "@/server/services/program-ingestion/call-text-parse";

const baseTrace = (patch: Partial<EnrichmentTrace> = {}): EnrichmentTrace => ({
  officialUrl: "https://example.edu/programme",
  targetIntakeYear: "2027/2028",
  payAcademicYear: "2026/2027",
  fetchFailed: false,
  enrichFailed: false,
  enrichFailureReason: null,
  hasAdmissionCallDocument: false,
  documents: [
    {
      url: "https://example.edu/programme",
      sourceType: "PROGRAMME_PAGE",
      academicYear: "2026/2027",
      extractionQuality: "OK",
      parserVersion: "call-v1.4",
      parseQuality: "OK",
      body: "Modalità di accesso Prova in ingresso",
      isPdf: false,
      ocrAttempted: false,
      ocrSucceeded: false,
      fetchOk: true,
    },
  ],
  parsed: null,
  falseSourceRejections: 0,
  ocrSuccessCount: 0,
  ocrFailureCount: 0,
  manualVerifiedFields: [],
  ...patch,
});

describe("field-reason-classifier", () => {
  it("accepts legacy enrichment traces without array fields", () => {
    const legacyTrace = {
      ...baseTrace(),
      documents: undefined,
      manualVerifiedFields: undefined,
    } as unknown as EnrichmentTrace;

    expect(() =>
      buildFieldStatusesFromDossier({
        dossier: {
          teachingLanguages: ["English"],
          languageRequirement: "B2",
          accessMode: "OPEN",
          selection: "UNKNOWN",
          examsDisplay: null,
          tuitionMin: null,
          tuitionMax: null,
          tuitionFixed: null,
          deadlines: [],
          euSeats: null,
          nonEuSeats: null,
          seatsUnlimited: true,
          callFreshness: "indicative",
          academicYear: "2026/2027",
          officialUrl: "https://example.edu/programme",
          admissionCallUrl: null,
          extractQuality: "OK",
        },
        trace: legacyTrace,
      })
    ).not.toThrow();
  });

  it("marks missing call for target year as NOT_PUBLISHED_FOR_TARGET_YEAR", () => {
    const statuses = buildFieldStatusesFromDossier({
      dossier: {
        teachingLanguages: ["English"],
        languageRequirement: null,
        accessMode: "UNKNOWN",
        selection: "UNKNOWN",
        examsDisplay: null,
        tuitionMin: null,
        tuitionMax: null,
        tuitionFixed: null,
        deadlines: [],
        euSeats: null,
        nonEuSeats: null,
        seatsUnlimited: false,
        callFreshness: "unknown",
        academicYear: "2026/2027",
        officialUrl: "https://example.edu/programme",
        admissionCallUrl: null,
        extractQuality: "OK",
      },
      trace: baseTrace(),
    });
    expect(statuses.admissionCall.reason).toBe("NOT_PUBLISHED_FOR_TARGET_YEAR");
    expect(statuses.admissionCall.value).toBeNull();
    expect(isFieldExplained(statuses.admissionCall)).toBe(true);
  });

  it("classifies empty tuition on previous-year row as ONLY_PREVIOUS_YEAR_AVAILABLE", () => {
    const statuses = buildFieldStatusesFromDossier({
      dossier: {
        teachingLanguages: ["English"],
        languageRequirement: null,
        accessMode: "OPEN",
        selection: "NONE",
        examsDisplay: null,
        tuitionMin: null,
        tuitionMax: null,
        tuitionFixed: null,
        deadlines: [],
        euSeats: null,
        nonEuSeats: null,
        seatsUnlimited: false,
        callFreshness: "indicative",
        academicYear: "2026/2027",
        officialUrl: "https://example.edu/programme",
        admissionCallUrl: null,
        extractQuality: "OK",
      },
      trace: baseTrace(),
    });
    expect(statuses.tuition.reason).toBe("ONLY_PREVIOUS_YEAR_AVAILABLE");
    expect(statuses.tuition.value).toBeNull();
    expect(isFieldExplained(statuses.tuition)).toBe(true);
  });

  it("keeps previous-year tuition value and marks it indicative", () => {
    const statuses = buildFieldStatusesFromDossier({
      dossier: {
        teachingLanguages: ["English"],
        languageRequirement: null,
        accessMode: "OPEN",
        selection: "NONE",
        examsDisplay: null,
        tuitionMin: 1500,
        tuitionMax: 3000,
        tuitionFixed: null,
        deadlines: [],
        euSeats: null,
        nonEuSeats: null,
        seatsUnlimited: true,
        callFreshness: "indicative",
        academicYear: "2026/2027",
        officialUrl: "https://example.edu/programme",
        admissionCallUrl: null,
        extractQuality: "OK",
      },
      trace: baseTrace(),
    });
    expect(isFieldFilled(statuses.tuition)).toBe(true);
    expect(statuses.tuition.value).toEqual({
      min: 1500,
      max: 3000,
      fixed: null,
    });
    expect(statuses.tuition.reason).toBe("ONLY_PREVIOUS_YEAR_AVAILABLE");
    expect(statuses.tuition.freshness).toBe("indicative");
  });

  it("keeps previous-year deadline value and marks it indicative", () => {
    const deadline = new Date("2026-04-20T12:00:00Z");
    const statuses = buildFieldStatusesFromDossier({
      dossier: {
        teachingLanguages: ["English"],
        languageRequirement: null,
        accessMode: "CLOSED",
        selection: "ENTRANCE_EXAM",
        examsDisplay: "TOLC",
        tuitionMin: null,
        tuitionMax: null,
        tuitionFixed: null,
        deadlines: [{ roundName: "Round 1", deadline }],
        euSeats: null,
        nonEuSeats: 40,
        seatsUnlimited: false,
        callFreshness: "indicative",
        academicYear: "2026/2027",
        officialUrl: "https://example.edu/programme",
        admissionCallUrl: "https://example.edu/bando-2026.pdf",
        extractQuality: "OK",
      },
      trace: baseTrace({ hasAdmissionCallDocument: true }),
    });
    expect(isFieldFilled(statuses.deadline)).toBe(true);
    expect(statuses.deadline.value).not.toBeNull();
    expect(statuses.deadline.reason).toBe("ONLY_PREVIOUS_YEAR_AVAILABLE");
    expect(statuses.deadline.freshness).toBe("indicative");
    expect(statuses.access.reason).toBe("ONLY_PREVIOUS_YEAR_AVAILABLE");
    expect(statuses.admissionCall.reason).toBe("ONLY_PREVIOUS_YEAR_AVAILABLE");
    expect(statuses.admissionCall.value).toEqual({
      url: "https://example.edu/bando-2026.pdf",
      freshness: "indicative",
    });
  });

  it("does not mark current-year filled access as previous-year", () => {
    const statuses = buildFieldStatusesFromDossier({
      dossier: {
        teachingLanguages: ["English"],
        languageRequirement: "English B2",
        accessMode: "OPEN",
        selection: "EVALUATION",
        examsDisplay: null,
        tuitionMin: null,
        tuitionMax: null,
        tuitionFixed: null,
        deadlines: [],
        euSeats: null,
        nonEuSeats: null,
        seatsUnlimited: true,
        callFreshness: "current",
        academicYear: "2027/2028",
        officialUrl: "https://example.edu/programme",
        admissionCallUrl: "https://example.edu/bando-2027.pdf",
        extractQuality: "OK",
      },
      trace: baseTrace({
        payAcademicYear: "2027/2028",
        hasAdmissionCallDocument: true,
        documents: [
          {
            url: "https://example.edu/bando-2027.pdf",
            sourceType: "ADMISSION_CALL",
            academicYear: "2027/2028",
            extractionQuality: "OK",
            parserVersion: "call-v1.4",
            parseQuality: "OK",
            body: "accesso libero",
            isPdf: true,
            ocrAttempted: false,
            ocrSucceeded: false,
            fetchOk: true,
          },
        ],
      }),
    });
    expect(isFieldFilled(statuses.access)).toBe(true);
    expect(statuses.access.reason).toBeNull();
    expect(statuses.access.freshness).toBe("current");
  });
});

describe("prova in ingresso programme page parsing", () => {
  it("recognises knowledge verification as OPEN + EVALUATION without admission exam", () => {
    const html = `<html><body>Modalità di accesso Prova in ingresso per la verifica delle conoscenze Lingua Inglese</body></html>`;
    const parsed = parseCallText(html, "https://example.edu/programme");
    expect(parsed.accessMode.value).toBe("OPEN");
    expect(parsed.admissionRegime.selection.value).toBe("EVALUATION");
    expect(parsed.exams.some((e) => e.name === "ADMISSION_TEST")).toBe(false);
    expect(parsed.exams.some((e) => /IELTS|TOEFL/i.test(e.name))).toBe(false);
  });
});
