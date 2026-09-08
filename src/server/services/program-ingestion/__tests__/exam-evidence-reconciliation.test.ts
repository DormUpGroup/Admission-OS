import { describe, expect, it } from "vitest";
import { verifiedExamEvidenceFromText } from "../exam-evidence-reconciliation";

describe("exam evidence reconciliation", () => {
  it("turns a quoted official TOLC-I sentence into a card fact", () => {
    const text =
      "English language proficiency at B2 level (CEFR). Initial preparation is assessed through the TOLC-I (Engineering) test, organized by CISIA.";
    expect(
      verifiedExamEvidenceFromText(
        text,
        "https://uni.example.it/computer-engineering",
        "2026/2027"
      )
    ).toMatchObject({
      description: "TOLC-I",
      quote:
        "Initial preparation is assessed through the TOLC-I (Engineering) test, organized by CISIA.",
    });
  });

  it("turns a quoted CEnT-S threshold into a card fact", () => {
    const text =
      "Candidates will be suitable for the admission to the oral interview with a CEnT-S normalized score equal or higher than 15 points.";
    expect(
      verifiedExamEvidenceFromText(
        text,
        "https://economia.uniroma2.it/ba/business-administration-economics/call-for-application/",
        "2026/2027"
      )
    ).toMatchObject({
      description: "CEnT-S ≥ 15",
      quote: text,
    });
  });

  it("does not create an exam fact without an exact source quote", () => {
    expect(
      verifiedExamEvidenceFromText(
        "The university offers TOLC preparation materials.",
        "https://uni.example.it/programme"
      )
    ).toBeNull();
  });
});
