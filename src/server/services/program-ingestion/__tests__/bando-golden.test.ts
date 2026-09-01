import { describe, expect, it } from "vitest";
import {
  aggregateFieldPrecision,
  evaluateParsed,
  loadBandoFixtures,
} from "@/server/services/program-ingestion/bando-eval";
import { parseCallText } from "@/server/services/program-ingestion/call-text-parse";
import {
  discoverBandoUrls,
  pickFollowLinks,
  admissionSiblingUrls,
} from "@/server/services/program-ingestion/bando-url-discover";
import { readFileSync } from "fs";
import path from "path";

describe("bando golden fixtures", () => {
  const fixtures = loadBandoFixtures().filter((f) => f.id !== "discover-tasse-html");

  it("loads at least 8 fixtures", () => {
    expect(fixtures.length).toBeGreaterThanOrEqual(8);
  });

  for (const f of fixtures) {
    it(`parses ${f.id}`, () => {
      const parsed = parseCallText(f.source, `https://uni.example.it/${f.id}`, {
        academicYear: f.academicYear,
      });
      const checks = evaluateParsed(parsed, f.expected);
      for (const [field, c] of Object.entries(checks)) {
        expect(c.ok, `${f.id}.${field}: ${c.detail}`).toBe(true);
      }
    });
  }

  it("aggregate precision is defined", () => {
    const agg = aggregateFieldPrecision(fixtures);
    expect(Object.keys(agg).length).toBeGreaterThan(0);
  });
});

describe("discover tasse/requisiti", () => {
  it("ranks bando and finds tasse follow links", () => {
    const html = readFileSync(
      path.join(
        process.cwd(),
        "tests/fixtures/bando/discover-tasse-html/source.html"
      ),
      "utf8"
    );
    const found = discoverBandoUrls(html, "https://uni.example.it/corso", {
      academicYear: "2027/2028",
      limit: 5,
    });
    expect(found.some((c) => c.url.includes("bando-2027-2028.pdf"))).toBe(true);
    expect(found.some((c) => c.kind === "tasse")).toBe(true);
    const follow = pickFollowLinks(found, 2);
    expect(follow.length).toBeGreaterThan(0);
    expect(follow[0].kind === "tasse" || follow[0].kind === "requisiti").toBe(
      true
    );
  });

  it("synthesizes Unibo how-to-enrol siblings from programme root", () => {
    const siblings = admissionSiblingUrls(
      "https://corsi.unibo.it/1cycle/EconomicsFinance"
    );
    expect(siblings.some((c) => c.url.endsWith("/how-to-enrol"))).toBe(true);
    expect(siblings.some((c) => c.url.endsWith("/admission"))).toBe(true);
    expect(siblings.some((c) => c.kind === "tasse" && /unibo\.it/i.test(c.url))).toBe(
      true
    );
  });

  it("rejects quality-policy PDFs as admission sources", () => {
    const html = `
      <a href="/uploads/Visione-della-qualita-e-politiche-per-la-qualita-2025.pdf">Qualità</a>
      <a href="/ammissione/bando-2026.pdf">Bando di ammissione 2026</a>
    `;
    const found = discoverBandoUrls(html, "https://www.lum.it/corso", {
      academicYear: "2026/2027",
      limit: 5,
    });
    expect(found.every((c) => !/visione/i.test(c.url))).toBe(true);
    expect(found.some((c) => /bando/i.test(c.url))).toBe(true);
  });
});
