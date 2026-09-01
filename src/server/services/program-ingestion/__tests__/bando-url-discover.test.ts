import { describe, expect, it } from "vitest";
import { isRejectedEnrichmentCandidateUrl } from "@/server/services/program-ingestion/bando-url-discover";

describe("isRejectedEnrichmentCandidateUrl", () => {
  it("rejects quality-policy and non-admission welfare URLs", () => {
    expect(
      isRejectedEnrichmentCandidateUrl(
        "https://www.unibo.it/visione-della-qualita.pdf"
      )
    ).toBe(true);
    expect(
      isRejectedEnrichmentCandidateUrl(
        "https://www.unito.it/agevolazioni-trasporto-2025.pdf"
      )
    ).toBe(true);
  });

  it("accepts admission or tuition URLs", () => {
    expect(
      isRejectedEnrichmentCandidateUrl(
        "https://corsi.unibo.it/1cycle/EconomicsFinance/how-to-enrol"
      )
    ).toBe(false);
    expect(
      isRejectedEnrichmentCandidateUrl(
        "https://www.unibo.it/en/services-and-opportunities/tuition-fees"
      )
    ).toBe(false);
  });
});
