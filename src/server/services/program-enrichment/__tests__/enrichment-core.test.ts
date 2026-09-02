import { describe, expect, it } from "vitest";
import { assertSafeHttpUrl, isSameUniversityDomain } from "../url-safety";
import {
  quoteExistsInDocument,
  validateEvidenceQuote,
} from "../quote-validator";
import { extractFromHtml } from "../html-extract";
import {
  factAppliesToCategory,
  scopeForApplicantCategory,
} from "../matching-context";
import { shouldEscalateToTerra, validateOutputQuotes } from "../luna-terra";
import { createFakeOfficialSiteNavigator } from "../official-site-navigator";
import { UNIBO_FIXTURE_PAGES } from "./fixtures/unibo";
import type { EnrichmentOutput } from "../schema";

describe("url-safety", () => {
  it("allows https university URLs", () => {
    const r = assertSafeHttpUrl("https://corsi.unibo.it/1cycle/x");
    expect(r.ok).toBe(true);
  });

  it("blocks localhost and private IPs", () => {
    expect(assertSafeHttpUrl("http://localhost/x").ok).toBe(false);
    expect(assertSafeHttpUrl("http://127.0.0.1/x").ok).toBe(false);
    expect(assertSafeHttpUrl("http://192.168.1.1/x").ok).toBe(false);
  });

  it("blocks file and userinfo", () => {
    expect(assertSafeHttpUrl("file:///etc/passwd").ok).toBe(false);
    expect(assertSafeHttpUrl("https://user:pass@unibo.it/").ok).toBe(false);
  });

  it("allows same university subdomains", () => {
    expect(isSameUniversityDomain("corsi.unibo.it", "www.unibo.it")).toBe(true);
    expect(isSameUniversityDomain("google.com", "unibo.it")).toBe(false);
  });

  it("blocks cross-domain when origin set", () => {
    const r = assertSafeHttpUrl("https://google.com/search", {
      allowHostname: "unibo.it",
    });
    expect(r.ok).toBe(false);
  });
});

describe("quote-validator", () => {
  it("accepts verbatim quotes present in document", () => {
    const doc = "Non-EU applicants residing abroad must take the SAT as entrance exam.";
    expect(
      quoteExistsInDocument(
        "must take the SAT as entrance exam",
        doc
      )
    ).toBe(true);
  });

  it("rejects hallucinated quotes", () => {
    const r = validateEvidenceQuote(
      "Students must submit IELTS 9.0 for entrance exam",
      "Non-EU applicants residing abroad must take the SAT as entrance exam."
    );
    expect(r.accepted).toBe(false);
    expect(r.reason).toBe("quote_not_found");
  });
});

describe("applicant category scope", () => {
  it("maps EU_EQUIVALENT to EU_CITIZEN scope", () => {
    expect(scopeForApplicantCategory("EU_EQUIVALENT")).toBe("EU_CITIZEN");
  });

  it("does not apply non-EU facts to EU", () => {
    expect(
      factAppliesToCategory("NON_EU_RESIDENT_ABROAD", "EU_CITIZEN")
    ).toBe(false);
    expect(
      factAppliesToCategory("EU_CITIZEN", "NON_EU_RESIDENT_ABROAD")
    ).toBe(false);
    expect(factAppliesToCategory("ALL", "EU_CITIZEN")).toBe(true);
  });

  it("blocks category-specific facts when UNKNOWN", () => {
    expect(
      factAppliesToCategory("NON_EU_RESIDENT_ABROAD", "UNKNOWN")
    ).toBe(false);
  });
});

describe("Bologna navigator fixture", () => {
  it("navigates root → how-to-enrol and exposes Non-EU Entrance exam / SAT text", async () => {
    const nav = createFakeOfficialSiteNavigator({
      pages: {
        root: UNIBO_FIXTURE_PAGES.root,
        enrol: UNIBO_FIXTURE_PAGES.enrol,
      },
    });
    const root = await nav.inspect_programme_site(
      UNIBO_FIXTURE_PAGES.root.url
    );
    expect("error" in root).toBe(false);
    if ("error" in root) return;

    expect(root.cleanText.toLowerCase()).toContain("bologna");
    const enrolLink = root.links.find((l) =>
      l.url.includes("how-to-enrol")
    );
    expect(enrolLink).toBeTruthy();

    const enrol = await nav.follow_official_link(enrolLink!.linkId);
    expect("error" in enrol).toBe(false);
    if ("error" in enrol) return;

    expect(enrol.cleanText).toMatch(/SAT/i);
    expect(enrol.cleanText).toMatch(/Non-EU/i);

    const entrance = enrol.sections.find((s) =>
      /entrance exam/i.test(s.label)
    );
    expect(entrance?.text).toMatch(/SAT/i);

    const quote =
      "Non-EU applicants residing abroad must take the SAT as entrance exam for admission.";
    expect(
      validateEvidenceQuote(quote, enrol.cleanText).accepted
    ).toBe(true);
  });

  it("extracts tabs from enrol HTML", () => {
    const page = extractFromHtml(
      UNIBO_FIXTURE_PAGES.enrol.html,
      UNIBO_FIXTURE_PAGES.enrol.url
    );
    const labels = page.sections.map((s) => s.label.toLowerCase());
    expect(labels.some((l) => l.includes("non-eu") || l.includes("entrance"))).toBe(
      true
    );
  });
});

describe("validateOutputQuotes / escalation", () => {
  const base: EnrichmentOutput = {
    campuses: [],
    access: [],
    selection: [],
    admissionExams: [
      {
        value: "SAT",
        sourceDocumentId: "doc-unibo-enrol",
        sourceUrl: UNIBO_FIXTURE_PAGES.enrol.url,
        quote:
          "Non-EU applicants residing abroad must take the SAT as entrance exam for admission.",
        academicYear: "2026/2027",
        scope: "NON_EU_RESIDENT_ABROAD",
        freshness: "CURRENT",
        confidence: "HIGH",
      },
    ],
    languageRequirements: [],
    deadlines: [],
    tuition: [],
    seats: [],
    requiredDocuments: [],
    importantNotes: [],
    sourceConflicts: [],
    unresolvedFields: [],
    siteNavigationSummary: { hops: [], documentsUsed: [] },
  };

  it("keeps SAT fact with valid quote and NON_EU scope", () => {
    const docs = new Map([
      [UNIBO_FIXTURE_PAGES.enrol.sourceDocumentId, UNIBO_FIXTURE_PAGES.enrol.html.replace(/<[^>]+>/g, " ")],
    ]);
    // Use clean text
    const clean = extractFromHtml(
      UNIBO_FIXTURE_PAGES.enrol.html,
      UNIBO_FIXTURE_PAGES.enrol.url
    ).cleanText;
    docs.set("doc-unibo-enrol", clean);

    const { valid, rejectCount } = validateOutputQuotes(base, docs);
    expect(rejectCount).toBe(0);
    expect(valid.admissionExams).toHaveLength(1);
    expect(valid.admissionExams[0].scope).toBe("NON_EU_RESIDENT_ABROAD");
  });

  it("rejects hallucinated exam fact", () => {
    const poisoned: EnrichmentOutput = {
      ...base,
      admissionExams: [
        {
          ...base.admissionExams[0],
          quote: "Applicants must sit the Tolc-E imaginary exam tomorrow",
        },
      ],
    };
    const clean = extractFromHtml(
      UNIBO_FIXTURE_PAGES.enrol.html,
      UNIBO_FIXTURE_PAGES.enrol.url
    ).cleanText;
    const { valid, rejectCount, invalidCritical } = validateOutputQuotes(
      poisoned,
      new Map([["doc-unibo-enrol", clean]])
    );
    expect(rejectCount).toBe(1);
    expect(valid.admissionExams).toHaveLength(0);
    expect(invalidCritical).toContain("admissionExams");
  });

  it("escalates when quotes invalid", () => {
    expect(
      shouldEscalateToTerra({
        output: base,
        quoteRejects: 1,
        invalidCritical: ["admissionExams"],
        forShortlist: true,
        categorySpecificRules: true,
      })
    ).toBe(true);
  });
});
