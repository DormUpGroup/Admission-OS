import { describe, expect, it } from "vitest";
import { mapProgramsAnswersToProfile } from "@/lib/questionnaire-programs";
import { UNIVERSITALY_SYNONYM_FALLBACK_MIN_CANDIDATES, MATCH_LIMIT_MIN } from "@/lib/program-matching/config";
import { synonymsForInterests } from "@/lib/program-matching/taxonomy";

describe("questionnaire map normalization", () => {
  it("treats Оба case-insensitively as English scalar (dual langs via matching-profile)", () => {
    const a = mapProgramsAnswersToProfile({
      studyLanguage: "Рассматриваю оба варианта",
      studyLevelPlan: "Бакалавриат",
      preferredDirections: ["Финансы"],
      preferredCities: ["Milano"],
    });
    expect(a.preferredLanguage).toBe("English");

    const b = mapProgramsAnswersToProfile({
      studyLanguage: "ОБА",
      studyLevelPlan: "Бакалавриат",
      preferredDirections: ["Финансы"],
      preferredCities: [],
    });
    expect(b.preferredLanguage).toBe("English");
  });

  it("maps Итальянский without expanding Оба incorrectly", () => {
    const m = mapProgramsAnswersToProfile({
      studyLanguage: "Итальянский",
      studyLevelPlan: "Бакалавриат",
      preferredDirections: ["Дизайн"],
      preferredCities: ["Roma"],
    });
    expect(m.preferredLanguage).toBe("Italian");
  });

  it("maps Вся Италия to empty preferred cities", () => {
    const m = mapProgramsAnswersToProfile({
      studyLanguage: "Английский",
      studyLevelPlan: "Бакалавриат",
      preferredDirections: ["Компьютерные технологии"],
      preferredCities: ["Вся Италия"],
    });
    expect(m.preferredCities).toEqual([]);
  });
});

describe("synonym threshold config", () => {
  it("aligns with curator match minimum", () => {
    expect(UNIVERSITALY_SYNONYM_FALLBACK_MIN_CANDIDATES).toBe(MATCH_LIMIT_MIN);
  });

  it("has CS direction synonyms", () => {
    const syn = synonymsForInterests(["Компьютерные технологии"]);
    expect(syn.some((s) => /computer/i.test(s))).toBe(true);
  });
});
