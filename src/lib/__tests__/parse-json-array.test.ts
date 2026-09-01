import { describe, expect, it } from "vitest";
import { parseJsonArray } from "@/lib/parse-json-array";

describe("parseJsonArray", () => {
  it("returns [] for empty input", () => {
    expect(parseJsonArray(null)).toEqual([]);
    expect(parseJsonArray(undefined)).toEqual([]);
    expect(parseJsonArray("")).toEqual([]);
  });

  it("parses string arrays", () => {
    expect(parseJsonArray('["EN","IT"]')).toEqual(["EN", "IT"]);
    expect(parseJsonArray("[1,2]")).toEqual(["1", "2"]);
  });

  it("returns [] for invalid JSON or non-array", () => {
    expect(parseJsonArray("{")).toEqual([]);
    expect(parseJsonArray('"hello"')).toEqual([]);
    expect(parseJsonArray("{}")).toEqual([]);
  });
});
