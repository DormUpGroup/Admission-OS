import { describe, expect, it } from "vitest";
import {
  CURATOR_HANDOFF_REQUESTS,
  escalationIsCuratorHandoff,
  explicitCuratorRequestCount,
  isExplicitCuratorRequest,
  shouldHandChatToCurator,
} from "../curator-handoff";

describe("explicit curator request", () => {
  it("counts a direct ask and ignores a consultation or a price", () => {
    expect(isExplicitCuratorRequest("Хочу поговорить с куратором")).toBe(true);
    expect(isExplicitCuratorRequest("Передайте меня куратору")).toBe(true);
    expect(isExplicitCuratorRequest("Позовите человека")).toBe(true);
    expect(isExplicitCuratorRequest("Можно оператора?")).toBe(true);
    expect(isExplicitCuratorRequest("Пусть куратор ответит")).toBe(true);
    expect(isExplicitCuratorRequest("Нужен живой человек")).toBe(true);
    expect(isExplicitCuratorRequest("Хочу консультацию")).toBe(false);
    expect(isExplicitCuratorRequest("Сколько стоит магистратура?")).toBe(false);
    expect(isExplicitCuratorRequest("Хочу в магистратуру")).toBe(false);
  });

  it("hands the chat over on the third explicit request", () => {
    const ask = { body: "Хочу куратора" };
    const other = { body: "Бакалавриат" };
    expect(explicitCuratorRequestCount([ask, other, ask])).toBe(2);
    expect(shouldHandChatToCurator([ask, other, ask])).toBe(false);
    const third = [ask, other, ask, other, ask];
    expect(explicitCuratorRequestCount(third)).toBe(CURATOR_HANDOFF_REQUESTS);
    expect(shouldHandChatToCurator(third)).toBe(true);
    expect(shouldHandChatToCurator([...third, other])).toBe(false);
  });

  it("treats a handoff reason as a curator request", () => {
    expect(escalationIsCuratorHandoff("Клиент просит куратора")).toBe(true);
    expect(escalationIsCuratorHandoff("Клиент просит выбрать конкретный вуз")).toBe(false);
  });
});
