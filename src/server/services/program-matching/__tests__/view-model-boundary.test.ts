import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

function source(path: string) {
  return readFileSync(join(process.cwd(), path), "utf8");
}

describe("programme decision read boundary", () => {
  it("matching and curator view-model do not read first-cycle or legacy tuition", () => {
    const matching = source(
      "src/server/services/program-matching/program-matching.ts"
    );
    const adminView = source(
      "src/app/(admin)/admin/students/[studentId]/page.tsx"
    );
    expect(matching).not.toContain("cycles[0]");
    expect(matching).not.toContain("pay.tuition");
    expect(adminView).not.toContain("cycles[0]");
    expect(adminView).not.toContain("pay.tuition");
  });

  it("Universitaly upsert never persists admission decision fields", () => {
    const upsert = source(
      "src/server/services/program-ingestion/universitaly-upsert.ts"
    );
    expect(upsert).not.toContain('field: "ACCESS_TYPE"');
    expect(upsert).not.toContain("data: { accessMode");
  });

  it("student programme card uses safe unknown labels", () => {
    const card = source("src/components/program-match-card.tsx");
    expect(card).toContain("Дедлайн уточняется");
    expect(card).toContain("Стоимость уточняется");
    expect(card).toContain("Квота уточняется");
  });
});
