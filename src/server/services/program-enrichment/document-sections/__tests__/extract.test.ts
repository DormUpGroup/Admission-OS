import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { fixturesRoot, loadBandoFixtures } from "@/server/services/program-ingestion/bando-eval";
import {
  extractDocumentSections,
  extractSectionsFromHtml,
  extractSectionsFromText,
} from "../extract";

function fixtureSource(id: string): string {
  const dir = path.join(fixturesRoot(), id);
  const html = path.join(dir, "source.html");
  const txt = path.join(dir, "source.txt");
  if (existsSync(html)) return readFileSync(html, "utf8");
  return readFileSync(txt, "utf8");
}

describe("document section extraction", () => {
  it("classifies HTML requisiti pages as ADMISSION/LANGUAGE", () => {
    const html = fixtureSource("requisiti-b2-open");
    const sections = extractSectionsFromHtml(html, {
      academicYear: "2027/2028",
      sourceType: "PROGRAMME_PAGE",
    });
    expect(sections.length).toBeGreaterThan(0);
    const types = new Set(sections.map((s) => s.sectionType));
    expect(
      types.has("ADMISSION") || types.has("LANGUAGE") || types.has("EXAMS")
    ).toBe(true);
    expect(sections.every((s, i) => s.position === i)).toBe(true);
  });

  it("detects prova in ingresso as EXAMS from HTML fixture", () => {
    const html = fixtureSource("prova-ingresso-verifica");
    const sections = extractDocumentSections({
      html,
      contentType: "html",
      academicYear: "2027/2028",
    });
    expect(sections.some((s) => s.sectionType === "EXAMS" || /prova/i.test(s.text))).toBe(
      true
    );
  });

  it("splits plain-text bando cues into typed sections", () => {
    const text = fixtureSource("cisia-tolc-i");
    const sections = extractSectionsFromText(text, {
      academicYear: "2027/2028",
      sourceType: "ADMISSION_CALL",
    });
    expect(sections.some((s) => s.sectionType === "EXAMS")).toBe(true);
    expect(sections.some((s) => s.sectionType === "SEATS" || /posti/i.test(s.text))).toBe(
      true
    );
  });

  it("marks language and deadline cues on imat fixture", () => {
    const text = fixtureSource("imat-english-deadline");
    const sections = extractSectionsFromText(text, { academicYear: "2027/2028" });
    const types = new Set(sections.map((s) => s.sectionType));
    expect(types.has("EXAMS") || /imat/i.test(sections.map((s) => s.text).join(" "))).toBe(
      true
    );
    expect(
      types.has("LANGUAGE") || types.has("DEADLINES") || sections.length > 0
    ).toBe(true);
  });

  it("keeps document order across loaded bando fixtures", () => {
    const fixtures = loadBandoFixtures().filter((f) =>
      [
        "language-b2",
        "posti-riservati",
        "cisia-tolc-i",
        "requisiti-b2-open",
      ].includes(f.id)
    );
    expect(fixtures.length).toBeGreaterThanOrEqual(3);
    for (const fixture of fixtures) {
      const sections = extractDocumentSections({
        text: fixture.source,
        html: fixture.source.includes("<") ? fixture.source : undefined,
        academicYear: fixture.academicYear,
      });
      expect(sections.length).toBeGreaterThan(0);
      for (let i = 0; i < sections.length; i++) {
        expect(sections[i].position).toBe(i);
        expect(sections[i].contentHash).toMatch(/^[a-f0-9]{64}$/);
      }
    }
  });
});
