import { describe, expect, it } from "vitest";
import { extractScopedQuotaRows } from "@/server/services/program-ingestion/call-text-parse";
import { resolveProgramFact } from "@/server/services/program-matching/source-resolver";
import { UNITO_BUSINESS_MANAGEMENT_QUOTAS_HTML } from "@/server/services/program-enrichment/__tests__/fixtures/unito";

describe("scoped programme quotas", () => {
  const rows = extractScopedQuotaRows(
    UNITO_BUSINESS_MANAGEMENT_QUOTAS_HTML
  );

  it("extracts each safely mapped category and preserves Marco Polo as unmapped", () => {
    expect(
      rows.find((row) => row.category === "NON_EU_RESIDENT_ABROAD")?.places
    ).toBe(40);
    expect(
      rows.find((row) => row.category === "NON_EU_RESIDENT_ITALY")?.places
    ).toBe(200);
    expect(rows.find((row) => row.category === "EU_CITIZEN")?.places).toBe(
      200
    );
    expect(rows.find((row) => row.category === "EU_EQUIVALENT")?.places).toBe(
      200
    );
    expect(rows.find((row) => row.category === "UNMAPPED")?.places).toBe(10);
  });

  it("resolves 40 for non-EU abroad and never treats 200 as universal non-EU", () => {
    const facts = rows
      .filter((row) => row.category !== "UNMAPPED")
      .map((row) => ({
        sourceType: "ADMISSION_CALL",
        origin: "OFFICIAL_FALLBACK",
        decisionStatus: "ELIGIBLE",
        normalizedValueJson: JSON.stringify({
          places: row.places,
          category: row.category,
          originalGroup: row.originalGroup,
        }),
        academicYear: "2026/2027",
        applicantCategoryScope: row.category,
        freshness: "CURRENT",
        confidence: row.confidence,
        evidenceQuote: row.snippet,
        sourceDocumentId: "unito-call",
        sourceUrl: "https://business-management.unito.it/admission",
        evidenceValidatedAt: new Date(),
      }));

    const winner = resolveProgramFact(facts, "2026/2027", {
      applicantCategory: "NON_EU_RESIDENT_ABROAD",
    });
    expect(JSON.parse(winner!.normalizedValueJson).places).toBe(40);
    expect(winner?.applicantCategoryScope).toBe(
      "NON_EU_RESIDENT_ABROAD"
    );
  });
});
