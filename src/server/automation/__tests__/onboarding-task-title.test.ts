import { describe, expect, it } from "vitest";
import { curatorFacingTaskTitle } from "@/server/automation/onboarding";

describe("curatorFacingTaskTitle", () => {
  it("turns gap codes and an English note into a curator sentence", () => {
    expect(
      curatorFacingTaskTitle(
        "no_program + no_curator: assign a curator and shortlist Bachelor-level Culinary Arts (Кулинария) programmes for the 2027/28 intake",
      ),
    ).toBe(
      "Назначьте куратора и подберите программы бакалавриата по направлению «Кулинария» на набор 2027/28.",
    );
  });

  it("keeps a Russian sentence that follows the codes", () => {
    expect(curatorFacingTaskTitle("no_curator: Назначьте куратора этому ученику.")).toBe(
      "Назначьте куратора этому ученику.",
    );
  });

  it("leaves an ordinary title unchanged", () => {
    expect(curatorFacingTaskTitle("Проверить диплом")).toBe("Проверить диплом");
  });
});
