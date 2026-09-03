import { describe, expect, it } from "vitest";
import {
  discoverBandoUrls,
  isRejectedEnrichmentCandidateUrl,
} from "@/server/services/program-ingestion/bando-url-discover";

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

  it("leaves fee pages out of the initial-shortlist crawl", () => {
    const html = `
      <a href="/admission">How to enrol</a>
      <a href="/tuition-fees">Tuition fees</a>
    `;
    const found = discoverBandoUrls(html, "https://example.edu/programme", {
      includeTuition: false,
    });

    expect(found.map((candidate) => candidate.kind)).toEqual(["bando"]);
  });
});
