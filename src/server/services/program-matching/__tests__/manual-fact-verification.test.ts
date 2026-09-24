import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const findAcademicYear = vi.hoisted(() => vi.fn());
const findFact = vi.hoisted(() => vi.fn());
const updateFact = vi.hoisted(() => vi.fn());
const createFact = vi.hoisted(() => vi.fn());
const upsertSourceDocument = vi.hoisted(() => vi.fn());
const buildMatchingProfile = vi.hoisted(() => vi.fn());

vi.mock("@/lib/db", () => ({
  prisma: {
    programAcademicYear: { findUnique: findAcademicYear },
    programFact: {
      findFirst: findFact,
      update: updateFact,
      create: createFact,
    },
  },
}));
vi.mock("@/server/services/program-ingestion/snapshot", () => ({
  upsertSourceDocument,
}));
vi.mock("@/server/services/program-matching/program-matching", () => ({
  buildMatchingProfile,
}));

import { verifyProgramDossierFacts } from "@/server/services/program-matching/manual-fact-verification";

const CATEGORY = "NON_EU_RESIDENT_ABROAD";

function academicYear(officialUrl: string | null = "https://www.unibo.it/en") {
  return {
    id: "pay-1",
    academicYear: "2026/27",
    programId: "prog-1",
    program: {
      officialUrl,
      universityId: "uni-1",
      name: "Ingegneria",
    },
  };
}

function baseInput(extra: Record<string, string> = {}) {
  return {
    actorUserId: "curator-1",
    studentId: "",
    programAcademicYearId: "pay-1",
    explicitCategory: CATEGORY,
    deadline: "",
    tuitionMin: "",
    tuitionMax: "",
    accessMode: "",
    nonEuSeats: "",
    examsDisplay: "",
    manualSourceUrl: "https://corsi.unibo.it/programme",
    evidenceQuote: "Official admission quote",
    ...extra,
  };
}

describe("verifyProgramDossierFacts", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    findAcademicYear.mockResolvedValue(academicYear());
    findFact.mockResolvedValue(null);
    updateFact.mockResolvedValue({});
    createFact.mockResolvedValue({ id: "fact-1" });
    upsertSourceDocument.mockResolvedValue({ document: { id: "src-1" } });
    buildMatchingProfile.mockResolvedValue({
      applicantCategory: "EU_CITIZEN",
    });
  });

  it("requires programAcademicYearId", async () => {
    await expect(
      verifyProgramDossierFacts(baseInput({ programAcademicYearId: "" }))
    ).rejects.toThrow("Missing programAcademicYearId");
  });

  it("requires applicant category", async () => {
    await expect(
      verifyProgramDossierFacts(baseInput({ explicitCategory: "UNKNOWN" }))
    ).rejects.toThrow("Applicant category is required");
  });

  it("writes verified facts for deadline", async () => {
    await verifyProgramDossierFacts(baseInput({ deadline: "2026-06-01" }));
    expect(createFact).toHaveBeenCalled();
  });

  it("rejects off-domain source", async () => {
    await expect(
      verifyProgramDossierFacts(
        baseInput({ manualSourceUrl: "https://evil.example/programme" })
      )
    ).rejects.toThrow("official domain");
  });

  it("requires source url and evidence", async () => {
    await expect(
      verifyProgramDossierFacts(
        baseInput({ manualSourceUrl: "", evidenceQuote: "" })
      )
    ).rejects.toThrow("Official source URL and evidence quote are required");
  });

  it("writes seats fact", async () => {
    await verifyProgramDossierFacts(baseInput({ nonEuSeats: "40" }));
    expect(createFact).toHaveBeenCalled();
  });

  it("writes tuition fact", async () => {
    await verifyProgramDossierFacts(
      baseInput({ tuitionMin: "1000", tuitionMax: "2000" })
    );
    expect(createFact).toHaveBeenCalled();
  });

  it("writes access mode", async () => {
    await verifyProgramDossierFacts(baseInput({ accessMode: "OPEN" }));
    expect(createFact).toHaveBeenCalled();
  });

  it("writes exams display", async () => {
    await verifyProgramDossierFacts(baseInput({ examsDisplay: "TOLC-I" }));
    expect(createFact).toHaveBeenCalled();
  });

  it("supersedes non-manual facts", async () => {
    findFact.mockResolvedValue({
      id: "old-1",
      sourceType: "AI",
    });
    await verifyProgramDossierFacts(baseInput({ accessMode: "CLOSED" }));
    expect(updateFact).toHaveBeenCalled();
    expect(createFact).toHaveBeenCalled();
  });

  it("updates existing manual fact", async () => {
    findFact.mockResolvedValue({
      id: "manual-1",
      sourceType: "MANUAL_VERIFIED",
    });
    await verifyProgramDossierFacts(baseInput({ accessMode: "OPEN" }));
    expect(updateFact).toHaveBeenCalled();
  });

  it("writes sat exam type", async () => {
    await verifyProgramDossierFacts(baseInput({ examsDisplay: "SAT required" }));
    expect(createFact).toHaveBeenCalled();
  });
});
