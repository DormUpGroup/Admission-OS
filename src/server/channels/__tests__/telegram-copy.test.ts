import { describe, expect, it } from "vitest";
import {
  explicitTelegramFirstName,
  explicitTelegramLeadName,
  isSameConsecutiveCommand,
  isTelegramPriceCommand,
  TELEGRAM_PRICES_TEXT,
  telegramWelcomeText,
} from "@/server/channels/telegram-copy";

describe("telegram greeting name", () => {
  it("greets by the Telegram first name", () => {
    expect(explicitTelegramFirstName("Мария Иванова")).toBe("Мария");
    const welcome = telegramWelcomeText("Мария Иванова");
    expect(welcome.startsWith("Здравствуйте, Мария.")).toBe(true);
    expect(welcome).toContain("Я помощник кураторов Immigrome");
    expect(welcome).toContain("Готовы начать?");
    expect(welcome).not.toContain("/prices");
    expect(welcome).not.toContain("визу");
    expect(welcome).not.toContain("несколько вопросов");
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

describe("consecutive commands", () => {
  it("treats a repeated price command as the same request", () => {
    expect(isSameConsecutiveCommand("prices", "/prices")).toBe(true);
    expect(isSameConsecutiveCommand("pricelist", "/price")).toBe(true);
    expect(isSameConsecutiveCommand("help", "/help")).toBe(true);
    expect(isSameConsecutiveCommand("prices", "/help")).toBe(false);
    expect(isSameConsecutiveCommand("prices", "Сколько стоит магистратура?")).toBe(false);
    expect(isSameConsecutiveCommand(null, "/prices")).toBe(false);
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
    expect(TELEGRAM_PRICES_TEXT).toContain("<b>130 €</b> / 1 час");
    expect(TELEGRAM_PRICES_TEXT).toContain("<b>50 €</b> / 20 минут");
    expect(TELEGRAM_PRICES_TEXT).toContain("<b>135 €</b> / 1 час");
    expect(TELEGRAM_PRICES_TEXT).toContain("<b>70 €</b> / 40 минут");
    expect(TELEGRAM_PRICES_TEXT).toContain("<b>100 €</b> / 1 час");
    expect(TELEGRAM_PRICES_TEXT).toContain("<b>160 €</b>");
    expect(TELEGRAM_PRICES_TEXT).toContain("<b>150 €</b>");
    expect(TELEGRAM_PRICES_TEXT).toContain("зависит от суммы");
    expect(TELEGRAM_PRICES_TEXT.length).toBeLessThan(4096);
    const withoutBoldPrices = TELEGRAM_PRICES_TEXT.replace(/<b>\d+\s*€<\/b>/g, "PRICE");
    expect(withoutBoldPrices).not.toMatch(/\d+\s*€/);
  });
});
