import { describe, expect, it } from "vitest";
import { isLeadProfileMessage, readLeadFacts } from "@/lib/lead-profile";

describe("readLeadFacts", () => {
  it("keeps known fields in card order and appends extra saved text", () => {
    expect(
      readLeadFacts({
        budget: " стипендия ",
        studyLevel: "бакалавриат",
        city: "Турин",
        notes: "",
        score: 7,
      }),
    ).toEqual([
      { key: "studyLevel", label: "Уровень", value: "бакалавриат" },
      { key: "budget", label: "Бюджет", value: "стипендия" },
      { key: "city", label: "city", value: "Турин" },
      { key: "score", label: "score", value: "7" },
    ]);
  });

  it("returns nothing when the chat has not saved a card yet", () => {
    expect(readLeadFacts(null)).toEqual([]);
  });
});

describe("isLeadProfileMessage", () => {
  it("keeps what the person wrote and drops bot commands", () => {
    expect(isLeadProfileMessage("Бакалавриат. Право")).toBe(true);
    expect(isLeadProfileMessage("  ")).toBe(false);
    expect(isLeadProfileMessage("/start")).toBe(false);
    expect(isLeadProfileMessage("/help@ImmigromeBot")).toBe(false);
  });
});
