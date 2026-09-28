import { describe, expect, it } from "vitest";
import { shouldSendBookingLink } from "../consent";

describe("booking consent", () => {
  it("sends the link when a person asked and the client agreed", () => {
    expect(
      shouldSendBookingLink({
        previousBody: "Добрый день, вы заинтересованы в видео консультации?",
        clientBody: "Более чем…",
      }),
    ).toBe(true);
  });

  it("sends the link when the bot asked and the client said yes", () => {
    expect(
      shouldSendBookingLink({
        previousBody: "Могу прислать запись на консультацию.",
        clientBody: "Да",
      }),
    ).toBe(true);
  });

  it("sends the link when the client asks for a consultation themselves", () => {
    expect(
      shouldSendBookingLink({
        previousBody: "Какой бюджет?",
        clientBody: "Хочу консультацию",
      }),
    ).toBe(true);
  });

  it("does not treat a later yes about something else as booking consent", () => {
    expect(
      shouldSendBookingLink({
        previousBody: "Сумма в год — только обучение или уже с проживанием?",
        clientBody: "Только обучение",
      }),
    ).toBe(false);
  });

  it("does not send the link when the client refuses", () => {
    expect(
      shouldSendBookingLink({
        previousBody: "Вы заинтересованы в видео консультации?",
        clientBody: "Нет, не надо",
      }),
    ).toBe(false);
  });
});
