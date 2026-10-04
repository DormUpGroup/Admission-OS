import { describe, expect, it } from "vitest";
import {
  cabinetPageUrl,
  missingQuestionnaire,
  questionnaireCabinetRequestMessage,
  questionnaireJoinRequestMessage,
  questionnairePath,
} from "@/server/registration/cabinet";

describe("cabinet questionnaire helpers", () => {
  it("builds a cabinet url from AUTH_URL", () => {
    expect(
      cabinetPageUrl("/portal/questionnaire", { AUTH_URL: "https://os.example/" }),
    ).toBe("https://os.example/portal/questionnaire");
  });

  it("picks personal before programs", () => {
    expect(missingQuestionnaire({})).toBe("personal");
    expect(
      missingQuestionnaire({
        questionnairePersonalJson: "{}",
        questionnaireAt: new Date(),
      }),
    ).toBe("programs");
    expect(
      missingQuestionnaire({
        questionnairePersonalJson: "{}",
        questionnaireProgramsJson: "{}",
      }),
    ).toBeNull();
  });

  it("writes a clear ask with the right path", () => {
    expect(questionnairePath("programs")).toBe("/portal/questionnaire-2");
    expect(
      questionnaireCabinetRequestMessage("personal", "https://os.example/portal/questionnaire"),
    ).toContain("анкету №1");
    expect(questionnaireJoinRequestMessage("https://os.example/join/abc")).toContain("Анкеты");
  });
});
