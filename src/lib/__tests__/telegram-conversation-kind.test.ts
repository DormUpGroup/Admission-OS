import { describe, expect, it } from "vitest";
import {
  isBotCommandBody,
  isTechnicalConversation,
  parseConversationFolder,
  pickPreviewMessage,
} from "@/lib/telegram-conversation-kind";

describe("isBotCommandBody", () => {
  it("detects /start and /help variants", () => {
    expect(isBotCommandBody("/start")).toBe(true);
    expect(isBotCommandBody("/start@ImmigromeBot")).toBe(true);
    expect(isBotCommandBody("/help")).toBe(true);
    expect(isBotCommandBody("/help please")).toBe(true);
  });

  it("rejects human text and empty", () => {
    expect(isBotCommandBody("Здравствуйте")).toBe(false);
    expect(isBotCommandBody("")).toBe(false);
    expect(isBotCommandBody(null)).toBe(false);
  });
});

describe("isTechnicalConversation", () => {
  it("is technical when there are no inbound messages", () => {
    expect(
      isTechnicalConversation([
        { direction: "OUTBOUND", body: "welcome" },
      ]),
    ).toBe(true);
    expect(isTechnicalConversation([])).toBe(true);
  });

  it("is technical when all inbound are commands", () => {
    expect(
      isTechnicalConversation([
        { direction: "INBOUND", body: "/start" },
        { direction: "OUTBOUND", body: "welcome" },
        { direction: "INBOUND", body: "/help" },
      ]),
    ).toBe(true);
  });

  it("is not technical once there is human inbound", () => {
    expect(
      isTechnicalConversation([
        { direction: "INBOUND", body: "/start" },
        { direction: "OUTBOUND", body: "welcome" },
        { direction: "INBOUND", body: "Нужна помощь с документами" },
      ]),
    ).toBe(false);
  });

  it("stays a chat when human inbound is outside the recent window", () => {
    expect(
      isTechnicalConversation(
        [
          { direction: "INBOUND", body: "/start" },
          { direction: "OUTBOUND", body: "как там с документами?" },
        ],
        { title: "Michael Bilak", username: "bilakmichael" },
        { hasHumanInbound: true },
      ),
    ).toBe(false);
  });

  it("is technical when the full history has no human inbound", () => {
    expect(
      isTechnicalConversation(
        [{ direction: "OUTBOUND", body: "welcome" }],
        { title: "Anna Rossi", username: "annarossi" },
        { hasHumanInbound: false },
      ),
    ).toBe(true);
  });

  it("treats fixture contacts as technical even with human text", () => {
    expect(
      isTechnicalConversation(
        [{ direction: "INBOUND", body: "hello-dedupe" }],
        { title: "Test", username: "tgtest" },
      ),
    ).toBe(true);
    expect(
      isTechnicalConversation(
        [{ direction: "INBOUND", body: "reply" }],
        { title: "Unk", username: "tgunk" },
      ),
    ).toBe(true);
  });
});

describe("pickPreviewMessage", () => {
  const t0 = new Date("2026-09-24T10:00:00Z");
  const t1 = new Date("2026-09-24T11:00:00Z");
  const t2 = new Date("2026-09-24T12:00:00Z");

  it("prefers last non-command message", () => {
    const preview = pickPreviewMessage([
      { direction: "INBOUND", body: "/start", createdAt: t0 },
      { direction: "OUTBOUND", body: "welcome", createdAt: t1 },
      { direction: "INBOUND", body: "/help", createdAt: t2 },
    ]);
    expect(preview?.body).toBe("welcome");
  });

  it("falls back to last message when all are commands", () => {
    const preview = pickPreviewMessage([
      { direction: "INBOUND", body: "/start", createdAt: t0 },
      { direction: "INBOUND", body: "/help", createdAt: t1 },
    ]);
    expect(preview?.body).toBe("/help");
  });
});

describe("parseConversationFolder", () => {
  it("defaults to chats", () => {
    expect(parseConversationFolder(undefined)).toBe("chats");
    expect(parseConversationFolder("bogus")).toBe("chats");
    expect(parseConversationFolder("technical")).toBe("technical");
  });
});
