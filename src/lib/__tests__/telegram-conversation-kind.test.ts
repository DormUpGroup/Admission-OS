import { describe, expect, it } from "vitest";
import {
  folderMoveTarget,
  isBotCommandBody,
  isTechnicalConversation,
  parseConversationFolder,
  pickPreviewMessage,
  resolveConversationFolder,
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

describe("resolveConversationFolder", () => {
  it("puts Diag probes in trash", () => {
    expect(
      resolveConversationFolder({
        messages: [{ direction: "INBOUND", body: "привет" }],
        contact: { title: "Diag", username: "diag_probe_user" },
        hasHumanInbound: true,
      }),
    ).toBe("trash");
    expect(
      resolveConversationFolder({
        messages: [],
        contact: { title: "Diag", username: null },
      }),
    ).toBe("trash");
  });

  it("files fixtures and command-only threads in trash", () => {
    expect(
      resolveConversationFolder({
        messages: [{ direction: "INBOUND", body: "/start" }],
        contact: { title: "Start", username: "tgstart" },
        hasHumanInbound: false,
      }),
    ).toBe("trash");
    expect(
      resolveConversationFolder({
        messages: [{ direction: "OUTBOUND", body: "welcome" }],
        contact: { title: "Anna Rossi", username: "annarossi" },
        hasHumanInbound: false,
      }),
    ).toBe("trash");
  });

  it("lets a saved folder override automatic placement", () => {
    expect(
      resolveConversationFolder({
        messages: [{ direction: "INBOUND", body: "привет" }],
        contact: { title: "Michael Bilak", username: "bilakmichael" },
        hasHumanInbound: true,
        inboxFolder: "technical",
      }),
    ).toBe("technical");
    expect(
      resolveConversationFolder({
        messages: [],
        contact: { title: "Diag", username: "diag_probe_user" },
        inboxFolder: "chats",
      }),
    ).toBe("chats");
  });
});

describe("folderMoveTarget", () => {
  it("swaps chats and technical, and restores trash to chats", () => {
    expect(folderMoveTarget("chats")).toEqual({
      folder: "technical",
      label: "Скрыть",
    });
    expect(folderMoveTarget("technical")).toEqual({
      folder: "chats",
      label: "Вернуть",
    });
    expect(folderMoveTarget("trash")).toEqual({
      folder: "chats",
      label: "В чаты",
    });
  });
});

describe("parseConversationFolder", () => {
  it("defaults to chats", () => {
    expect(parseConversationFolder(undefined)).toBe("chats");
    expect(parseConversationFolder("bogus")).toBe("chats");
    expect(parseConversationFolder("technical")).toBe("technical");
    expect(parseConversationFolder("trash")).toBe("trash");
  });
});
