import { describe, expect, it } from "vitest";
import { retrieveSections } from "../retrieve";
import type { RetrievalSectionInput } from "../types";

function section(
  partial: Partial<RetrievalSectionInput> &
    Pick<RetrievalSectionInput, "sourceDocumentId" | "heading" | "sectionType" | "text">
): RetrievalSectionInput {
  return {
    sourceUrl: partial.sourceUrl ?? "https://example.edu/bando",
    programId: partial.programId ?? "prog-1",
    programAcademicYearId: partial.programAcademicYearId ?? "pay-1",
    academicYear: partial.academicYear ?? "2027/2028",
    sourceType: partial.sourceType ?? "ADMISSION_CALL",
    sourceAuthority: partial.sourceAuthority ?? "Example University",
    retrievedAt: partial.retrievedAt ?? new Date(),
    position: partial.position ?? 0,
    metadata: partial.metadata ?? {},
    ...partial,
  };
}

describe("deterministic section retrieval", () => {
  it("ranks admission/exam snippets above general content", () => {
    const result = retrieveSections(
      [
        section({
          sourceDocumentId: "doc-1",
          heading: "About the campus",
          sectionType: "GENERAL",
          text: "The campus is located in the historic centre near parks and museums.",
          position: 0,
        }),
        section({
          sourceDocumentId: "doc-1",
          heading: "Admission test",
          sectionType: "EXAMS",
          text: "Admission test: CISIA TOLC-I is required for enrolment.",
          position: 1,
        }),
        section({
          sourceDocumentId: "doc-1",
          heading: "Requisiti di ammissione",
          sectionType: "ADMISSION",
          text: "Modalità di accesso: numero programmato.",
          position: 2,
        }),
      ],
      {
        academicYear: "2027/2028",
        applicantCategory: "NON_EU_RESIDENT_ABROAD",
        mode: "shortlist",
        sourceDocumentIds: ["doc-1"],
        neededFields: ["admissionExams", "access"],
      }
    );

    expect(result.snippets[0].sectionType).toMatch(/EXAMS|ADMISSION/);
    expect(result.snippets.map((s) => s.sectionType)).not.toEqual([
      "GENERAL",
      "EXAMS",
      "ADMISSION",
    ]);
    expect(result.snippets[0].score).toBeGreaterThan(
      result.snippets.find((s) => s.sectionType === "GENERAL")?.score ?? 0
    );
  });

  it("filters out sections from a different academic year", () => {
    const result = retrieveSections(
      [
        section({
          sourceDocumentId: "doc-old",
          heading: "Admission 2025/2026",
          sectionType: "ADMISSION",
          text: "Old rules for 2025/2026 only.",
          academicYear: "2025/2026",
          metadata: { academicYearHint: "2025/2026" },
        }),
        section({
          sourceDocumentId: "doc-new",
          heading: "Admission 2027/2028",
          sectionType: "ADMISSION",
          text: "Current rules for 2027/2028.",
          academicYear: "2027/2028",
          metadata: { academicYearHint: "2027/2028" },
        }),
      ],
      {
        academicYear: "2027/2028",
        applicantCategory: "EU_CITIZEN",
        mode: "shortlist",
        neededFields: ["access"],
      }
    );

    expect(result.snippets).toHaveLength(1);
    expect(result.snippets[0].sourceDocumentId).toBe("doc-new");
  });

  it("filters out category-specific sections for another applicant group", () => {
    const result = retrieveSections(
      [
        section({
          sourceDocumentId: "doc-1",
          heading: "Non-EU seats",
          sectionType: "SEATS",
          text: "18 posti riservati non-EU residing abroad.",
          metadata: {
            applicantCategoryHints: ["NON_EU_RESIDENT_ABROAD"],
          },
        }),
        section({
          sourceDocumentId: "doc-1",
          heading: "EU seats",
          sectionType: "SEATS",
          text: "40 posti per cittadini UE.",
          metadata: {
            applicantCategoryHints: ["EU_CITIZEN"],
          },
        }),
      ],
      {
        academicYear: "2027/2028",
        applicantCategory: "EU_CITIZEN",
        mode: "shortlist",
        neededFields: ["seats"],
      }
    );

    expect(result.snippets).toHaveLength(1);
    expect(result.snippets[0].heading).toBe("EU seats");
  });

  it("keeps shortlist context away from tuition-heavy general noise by type preference", () => {
    const result = retrieveSections(
      [
        section({
          sourceDocumentId: "doc-1",
          heading: "Tasse",
          sectionType: "TUITION",
          text: "Tuition ranges from €156 to €3.500 depending on ISEE.",
          position: 0,
        }),
        section({
          sourceDocumentId: "doc-1",
          heading: "Entrance exam",
          sectionType: "EXAMS",
          text: "Applicants must sit the SAT as entrance exam.",
          position: 1,
        }),
      ],
      {
        academicYear: "2027/2028",
        applicantCategory: "NON_EU_RESIDENT_ABROAD",
        mode: "shortlist",
        neededFields: ["admissionExams"],
      }
    );

    expect(result.snippets[0].sectionType).toBe("EXAMS");
  });

  it("does not truncate a snippet mid-quote when budget is tight", () => {
    const longQuote =
      "Non-EU applicants residing abroad must take the SAT as entrance exam for admission. ".repeat(
        40
      );
    const result = retrieveSections(
      [
        section({
          sourceDocumentId: "doc-1",
          heading: "Entrance exam",
          sectionType: "EXAMS",
          text: longQuote,
          position: 0,
        }),
        section({
          sourceDocumentId: "doc-1",
          heading: "About",
          sectionType: "GENERAL",
          text: "Campus overview text that should be dropped entirely when budget is exceeded.",
          position: 1,
        }),
      ],
      {
        academicYear: "2027/2028",
        applicantCategory: "NON_EU_RESIDENT_ABROAD",
        mode: "shortlist",
        neededFields: ["admissionExams"],
      },
      longQuote.length + 10
    );

    expect(result.snippets[0].text).toBe(longQuote);
    expect(result.truncated).toBe(true);
  });
});
