import { describe, expect, it } from "vitest";
import { MVP_CATALOG } from "@/server/services/program-ingestion/catalog-fixtures";
import { dedupeKey } from "@/server/services/program-ingestion/ingest";
import { contentHash } from "@/server/services/program-ingestion/snapshot";

describe("catalog ingestion fixtures", () => {
  it("contains 5–20+ programme-year rows across universities", () => {
    expect(MVP_CATALOG.length).toBeGreaterThanOrEqual(10);
    const unis = new Set(MVP_CATALOG.map((p) => p.universityName));
    expect(unis.size).toBeGreaterThanOrEqual(4);
  });

  it("does not hardcode a single academic year only", () => {
    const years = new Set(MVP_CATALOG.map((p) => p.academicYear));
    expect(years.has("2026/2027")).toBe(true);
    expect(years.has("2027/2028")).toBe(true);
  });

  it("keeps dedupe keys stable", () => {
    const keys = MVP_CATALOG.map(dedupeKey);
    expect(keys.every(Boolean)).toBe(true);
  });

  it("hashes source content for change detection", () => {
    expect(contentHash("a")).not.toBe(contentHash("b"));
    expect(contentHash("same")).toBe(contentHash("same"));
  });
});
