import { describe, expect, it } from "vitest";
import {
  cefrLevelForIelts,
  explainLanguageRequirement,
} from "@/lib/language-requirement";

describe("IELTS to CEFR explanation", () => {
  it("maps common IELTS bands to a student-friendly CEFR orientation", () => {
    expect(cefrLevelForIelts(5)).toBe("B1");
    expect(cefrLevelForIelts(6)).toBe("B2");
    expect(cefrLevelForIelts(7.5)).toBe("C1");
    expect(cefrLevelForIelts(8.5)).toBe("C2");
  });

  it("keeps an explicit university CEFR requirement unchanged", () => {
    expect(explainLanguageRequirement("English B2")).toBe("English B2");
  });

  it("explains IELTS without replacing the university's score", () => {
    expect(explainLanguageRequirement("IELTS Academic 6.0")).toBe(
      "IELTS Academic 6.0 · ориентир по CEFR: B2"
    );
  });
});
