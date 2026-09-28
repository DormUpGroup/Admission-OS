import { describe, expect, it } from "vitest";
import {
  explicitTelegramFirstName,
  explicitTelegramLeadName,
  isTelegramPriceCommand,
  TELEGRAM_PRICES_TEXT,
  telegramWelcomeText,
} from "@/server/channels/telegram-copy";

describe("telegram greeting name", () => {
  it("greets by the Telegram first name", () => {
    expect(explicitTelegramFirstName("Мария Иванова")).toBe("Мария");
    expect(telegramWelcomeText("Мария Иванова").startsWith("Здравствуйте, Мария.")).toBe(
      true,
    );
    expect(explicitTelegramLeadName("Анна-Мария Rossi")).toEqual({
      firstName: "Анна-Мария",
      lastName: "Rossi",
    });
  });

  it("skips a nick, digits, emoji, and placeholders", () => {
    expect(explicitTelegramFirstName("user_12")).toBeNull();
    expect(explicitTelegramFirstName("cool123")).toBeNull();
    expect(explicitTelegramFirstName("😎")).toBeNull();
    expect(explicitTelegramFirstName("user")).toBeNull();
    expect(explicitTelegramFirstName(null)).toBeNull();
    const unnamed = telegramWelcomeText("user_12");
    expect(unnamed.startsWith("Здравствуйте.\n")).toBe(true);
    expect(unnamed.includes("user_12")).toBe(false);
    expect(explicitTelegramLeadName("nick_name")).toEqual({
      firstName: null,
      lastName: null,
    });
  });
});

describe("price list", () => {
  it("accepts the price commands", () => {
    expect(isTelegramPriceCommand("prices")).toBe(true);
    expect(isTelegramPriceCommand("price")).toBe(true);
    expect(isTelegramPriceCommand("pricelist")).toBe(true);
    expect(isTelegramPriceCommand("start")).toBe(false);
  });

  it("lists site tariffs and services and links the tariffs block", () => {
    const tariffs = TELEGRAM_PRICES_TEXT.slice(0, TELEGRAM_PRICES_TEXT.indexOf("<b>Услуги</b>"));
    expect(tariffs).toContain("https://immigrome.ru/");
    expect(tariffs).toContain("1599 €");
    expect(tariffs).toContain("1799 €");
    expect(tariffs).toContain("1499 €");
    expect(tariffs).toContain("1399 €");
    expect(tariffs).toContain("999 €");
    expect(TELEGRAM_PRICES_TEXT).toContain("130 € / 1 час");
    expect(TELEGRAM_PRICES_TEXT).toContain("50 € / 20 минут");
    expect(TELEGRAM_PRICES_TEXT).toContain("135 € / 1 час");
    expect(TELEGRAM_PRICES_TEXT).toContain("70 € / 40 минут");
    expect(TELEGRAM_PRICES_TEXT).toContain("100 € / 1 час");
    expect(TELEGRAM_PRICES_TEXT).toContain("160 €");
    expect(TELEGRAM_PRICES_TEXT).toContain("150 €");
    expect(TELEGRAM_PRICES_TEXT).toContain("зависит от суммы");
    expect(TELEGRAM_PRICES_TEXT.length).toBeLessThan(4096);
  });
});
