import { describe, expect, it } from "vitest";
import { taskTitleAfterCuratorAssigned } from "@/server/services/assign-curator";

describe("taskTitleAfterCuratorAssigned", () => {
  it("closes a task that only asked to assign a curator", () => {
    expect(taskTitleAfterCuratorAssigned("Назначьте куратора.")).toBe("DONE");
  });

  it("keeps the programme half of a combined task", () => {
    expect(
      taskTitleAfterCuratorAssigned(
        "Назначьте куратора и подберите программы бакалавриата по направлению «Кулинария» на набор 2027/28.",
      ),
    ).toBe("Подберите программы бакалавриата по направлению «Кулинария» на набор 2027/28.");
  });

  it("leaves unrelated titles alone", () => {
    expect(taskTitleAfterCuratorAssigned("Проверить диплом")).toBe("Проверить диплом");
  });
});
