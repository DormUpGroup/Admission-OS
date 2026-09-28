import { describe, expect, it } from "vitest";
import { formatCuratorAutomationNotice } from "../curator-notice";

describe("formatCuratorAutomationNotice", () => {
  it("names the client, the problem, and the required action", () => {
    const notice = formatCuratorAutomationNotice({
      clientName: "Аня",
      problem: "бот не отправил сообщение, потому что нет chat_id.",
      action: "откройте переписку и ответьте клиенту вручную.",
    });
    expect(notice.title).toBe("Автоматика остановилась");
    expect(notice.body).toContain("Клиент: Аня.");
    expect(notice.body).toContain("Проблема: бот не отправил сообщение");
    expect(notice.body).toContain("Действие: откройте переписку");
  });
});
