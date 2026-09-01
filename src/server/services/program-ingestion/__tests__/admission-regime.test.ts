import { describe, expect, it } from "vitest";
import {
  inferAdmissionRegime,
  mergeAdmissionRegime,
} from "@/server/services/program-ingestion/admission-regime";
import { parseCallText } from "@/server/services/program-ingestion/call-text-parse";

describe("AdmissionRegime", () => {
  it("keeps open enrolment with language only out of admission exams", () => {
    const parsed = parseCallText(
      "Accesso libero. English B2 certificate required.",
      "https://state.example.it/programme"
    );
    expect(parsed.admissionRegime.access.value).toBe("OPEN");
    expect(parsed.admissionRegime.selection.value).toBe("NONE");
    expect(parsed.admissionRegime.admissionExams.value).toEqual([]);
    expect(parsed.admissionRegime.seats.value.unlimited).toBe(true);
  });

  it("parses EU, non-EU and total places without inventing a split", () => {
    const parsed = parseCallText(
      "Accesso a numero programmato. Posti complessivi: 100. 20 posti extra-UE. 80 posti comunitari.",
      "https://state.example.it/call"
    );
    expect(parsed.admissionRegime.access.value).toBe("CLOSED");
    expect(parsed.euSeats?.value).toBe(80);
    expect(parsed.nonEuSeats?.value).toBe(20);
    expect(parsed.totalSeats?.value).toBe(100);
  });

  it("keeps SAT or TOLC as one alternative list and identifies a real gate", () => {
    const parsed = parseCallText(
      "Admission test: SAT or TOLC-E. Accesso libero.",
      "https://state.example.it/call"
    );
    expect(parsed.admissionRegime.access.value).toBe("CLOSED");
    expect(parsed.admissionRegime.selection.value).toBe("ENTRANCE_EXAM");
    expect(parsed.admissionRegime.admissionExams.value.map((e) => e.name)).toEqual([
      "SAT",
      "TOLC-E",
    ]);
  });

  it("vetoes catalogue-style open access for a private selective programme", () => {
    const regime = inferAdmissionRegime({
      sourceUrl: "https://private.example.it/call",
      sourceType: "ADMISSION_CALL",
      access: "OPEN",
      ownership: "PRIVATE",
      admissionGate: true,
      exams: [{ name: "BOCCONI_TEST" }, { name: "SAT" }],
    });
    expect(regime.access.value).toBe("CLOSED");
    expect(regime.selection.value).toBe("ENTRANCE_EXAM");
  });

  it("merges fields independently by source priority", () => {
    const page = inferAdmissionRegime({
      sourceUrl: "https://uni.example.it/programme",
      sourceType: "PROGRAMME_PAGE",
      access: "OPEN",
      languageRequirement: "B2",
    });
    const call = inferAdmissionRegime({
      sourceUrl: "https://uni.example.it/call.pdf",
      sourceType: "ADMISSION_CALL",
      access: "CLOSED",
      admissionGate: true,
      exams: [{ name: "TOLC-E" }],
      nonEuSeats: 12,
    });
    const merged = mergeAdmissionRegime([page, call]);
    expect(merged.access.value).toBe("CLOSED");
    expect(merged.languageRequirement.value).toBe("B2");
    expect(merged.seats.value.nonEu).toBe(12);
  });

  it("uses Universitaly Accesso con diploma as low-precedence OPEN for public uni", () => {
    const uni = inferAdmissionRegime({
      sourceType: "UNIVERSITALY",
      access: "OPEN",
      accessSnippet: "Accesso con diploma",
      accessConfidence: "LOW",
      ownership: "PUBLIC",
    });
    expect(uni.access.value).toBe("OPEN");
    expect(uni.selection.value).toBe("NONE");
    expect(uni.seats.value.unlimited).toBe(true);
    const emptyPage = inferAdmissionRegime({
      sourceType: "PROGRAMME_PAGE",
      access: "UNKNOWN",
      ownership: "PUBLIC",
    });
    const merged = mergeAdmissionRegime([uni, emptyPage]);
    expect(merged.access.value).toBe("OPEN");
  });

  it("does not force OPEN from catalogue libero for private universities", () => {
    const regime = inferAdmissionRegime({
      sourceType: "UNIVERSITALY",
      access: "OPEN",
      ownership: "PRIVATE",
    });
    expect(regime.access.value).toBe("UNKNOWN");
  });
});
