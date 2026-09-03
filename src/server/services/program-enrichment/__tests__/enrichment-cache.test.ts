import { beforeEach, describe, expect, it, vi } from "vitest";

const { findFirst, factCount } = vi.hoisted(() => ({
  findFirst: vi.fn(),
  factCount: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    programEnrichmentRun: { findFirst },
    programFact: { count: factCount },
  },
}));

import {
  buildSourceFingerprint,
  findReusableEnrichmentRun,
} from "../enrichment-cache";

describe("AI enrichment cache", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("fingerprints official source content independently from prompt version", () => {
    expect(buildSourceFingerprint(["b", "a"], "v1")).toBe(
      buildSourceFingerprint(["a", "b"], "v2")
    );
  });

  it("reuses only exact category/fingerprint/prompt with materialized eligible facts", async () => {
    findFirst.mockResolvedValue({
      id: "run-1",
      resolvedFactIdsJson: JSON.stringify(["fact-1", "fact-2"]),
    });
    factCount.mockResolvedValue(2);
    const result = await findReusableEnrichmentRun({
      programAcademicYearId: "pay-1",
      applicantCategory: "NON_EU_RESIDENT_ABROAD",
      sourceFingerprint: "source-hash",
      promptVersion: "v2",
    });
    expect(result?.id).toBe("run-1");
    expect(findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          programAcademicYearId: "pay-1",
          applicantCategory: "NON_EU_RESIDENT_ABROAD",
          sourceFingerprint: "source-hash",
          promptVersion: "v2",
        }),
      })
    );
  });

  it("misses when persisted facts were removed or superseded", async () => {
    findFirst.mockResolvedValue({
      id: "run-1",
      resolvedFactIdsJson: JSON.stringify(["fact-1"]),
    });
    factCount.mockResolvedValue(0);
    await expect(
      findReusableEnrichmentRun({
        programAcademicYearId: "pay-1",
        applicantCategory: "EU_CITIZEN",
        sourceFingerprint: "source-hash",
        promptVersion: "v2",
      })
    ).resolves.toBeNull();
  });
});
