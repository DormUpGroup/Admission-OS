import { beforeEach, describe, expect, it, vi } from "vitest";

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

function baseInput(extra: Partial<Parameters<typeof verifyProgramDossierFacts>[0]> = {}) {
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

  it("rejects a missing programme year and an unresolved category", async () => {
    await expect(
      verifyProgramDossierFacts(baseInput({ programAcademicYearId: "" }))
    ).rejects.toThrow("Missing programAcademicYearId");
    await expect(
      verifyProgramDossierFacts(baseInput({ explicitCategory: "UNKNOWN" }))
    ).rejects.toThrow("Applicant category is required for manual verification");
    expect(findAcademicYear).not.toHaveBeenCalled();
  });

  it("uses the student profile category when the form omits one", async () => {
    await verifyProgramDossierFacts(
      baseInput({
        studentId: "student-1",
        explicitCategory: "",
        deadline: "2026-09-01",
      })
    );

    expect(buildMatchingProfile).toHaveBeenCalledWith("student-1");
    expect(createFact).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          field: "APPLICATION_DEADLINE",
          applicantCategoryScope: "EU_CITIZEN",
          dimensionKey: "APPLICATION_DEADLINE:EU_CITIZEN:::primary",
        }),
      })
    );
  });

  it("rejects an off-domain source when the official URL is safe", async () => {
    await expect(
      verifyProgramDossierFacts(
        baseInput({ manualSourceUrl: "https://example.com/call" })
      )
    ).rejects.toThrow(
      "Manual verification source must be on the official domain"
    );
    expect(upsertSourceDocument).not.toHaveBeenCalled();
  });

  it("accepts any safe source when the programme has no official URL", async () => {
    findAcademicYear.mockResolvedValue(academicYear(null));
    await verifyProgramDossierFacts(
      baseInput({
        manualSourceUrl: "https://example.com/call",
        deadline: "2026-09-01",
      })
    );
    expect(upsertSourceDocument).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceType: "MANUAL_VERIFIED",
        url: "https://example.com/call",
        status: "VERIFIED",
        extractionQuality: "MANUAL_VERIFIED",
      })
    );
  });

  it("supersedes a non-manual fact and creates a verified replacement", async () => {
    findFact.mockResolvedValue({ id: "old-fact", sourceType: "PARSER" });
    await verifyProgramDossierFacts(baseInput({ deadline: "2026-09-01" }));

    expect(updateFact).toHaveBeenCalledWith({
      where: { id: "old-fact" },
      data: { superseded: true },
    });
    expect(createFact).toHaveBeenCalledWith({
      data: expect.objectContaining({
        programId: "prog-1",
        programAcademicYearId: "pay-1",
        field: "APPLICATION_DEADLINE",
        academicYear: "2026/27",
        normalizedValueJson: JSON.stringify({
          date: "2026-09-01T12:00:00.000Z",
          roundName: "Primary",
        }),
        rawValue: "2026-09-01",
        sourceType: "MANUAL_VERIFIED",
        sourceDocumentId: "src-1",
        dimensionKey: `APPLICATION_DEADLINE:${CATEGORY}:::primary`,
        verifiedById: "curator-1",
        resolverVersion: "v2",
      }),
    });
  });

  it("updates an existing manual fact in place", async () => {
    findFact.mockResolvedValue({
      id: "manual-fact",
      sourceType: "MANUAL_VERIFIED",
    });
    await verifyProgramDossierFacts(baseInput({ nonEuSeats: "12" }));

    expect(updateFact).toHaveBeenCalledTimes(1);
    expect(updateFact).toHaveBeenCalledWith({
      where: { id: "manual-fact" },
      data: expect.objectContaining({
        sourceType: "MANUAL_VERIFIED",
        normalizedValueJson: JSON.stringify({
          places: 12,
          category: CATEGORY,
          originalGroup: "Manual curator verification",
        }),
        rawValue: `Manual: 12 places for ${CATEGORY}`,
        dimensionKey: `SEATS:${CATEGORY}:::${CATEGORY}`,
      }),
    });
    expect(createFact).not.toHaveBeenCalled();
  });

  it("classifies exam display text and skips empty optional fields", async () => {
    await verifyProgramDossierFacts(
      baseInput({ examsDisplay: "SAT 1200 or TOLC-E" })
    );
    expect(
      JSON.parse(createFact.mock.calls[0][0].data.normalizedValueJson)
    ).toEqual({
      description: "SAT 1200 or TOLC-E",
      type: "SAT",
    });

    vi.clearAllMocks();
    findAcademicYear.mockResolvedValue(academicYear());
    findFact.mockResolvedValue(null);
    upsertSourceDocument.mockResolvedValue({ document: { id: "src-1" } });
    await verifyProgramDossierFacts(baseInput({ examsDisplay: "TOLC-I" }));
    expect(
      JSON.parse(createFact.mock.calls[0][0].data.normalizedValueJson).type
    ).toBe("TOLC");

    vi.clearAllMocks();
    findAcademicYear.mockResolvedValue(academicYear());
    findFact.mockResolvedValue(null);
    upsertSourceDocument.mockResolvedValue({ document: { id: "src-1" } });
    await verifyProgramDossierFacts(
      baseInput({ examsDisplay: "university entrance exam" })
    );
    expect(
      JSON.parse(createFact.mock.calls[0][0].data.normalizedValueJson).type
    ).toBe("ADMISSION_TEST");

    vi.clearAllMocks();
    findAcademicYear.mockResolvedValue(academicYear());
    upsertSourceDocument.mockResolvedValue({ document: { id: "src-1" } });
    await verifyProgramDossierFacts(
      baseInput({
        tuitionMin: "nope",
        accessMode: "UNKNOWN",
      })
    );
    expect(upsertSourceDocument).toHaveBeenCalled();
    expect(createFact).not.toHaveBeenCalled();
    expect(updateFact).not.toHaveBeenCalled();
  });

  it("stores equal tuition bounds as a fixed amount", async () => {
    await verifyProgramDossierFacts(
      baseInput({ tuitionMin: "1000", tuitionMax: "1000", accessMode: "open" })
    );
    const tuition = createFact.mock.calls.find(
      (call) => call[0].data.field === "TUITION"
    );
    const access = createFact.mock.calls.find(
      (call) => call[0].data.field === "ACCESS_TYPE"
    );
    expect(tuition).toBeDefined();
    expect(access).toBeDefined();
    if (!tuition || !access) return;
    expect(JSON.parse(tuition[0].data.normalizedValueJson)).toEqual({
      min: 1000,
      max: 1000,
      fixed: 1000,
    });
    expect(tuition[0].data.rawValue).toBeNull();
    expect(tuition[0].data.dimensionKey).toBe(`TUITION:${CATEGORY}:::annual`);
    expect(JSON.parse(access[0].data.normalizedValueJson)).toEqual({
      mode: "OPEN",
    });
  });
});
