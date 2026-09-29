import { describe, expect, it } from "vitest";
import { HERMES_POLL_DEFER_MS } from "@/server/automation/hermes-client";
import {
  refreshHermesTyping,
  sendTelegramTyping,
  shouldShowIntakeTyping,
  TELEGRAM_TYPING_REFRESH_MS,
  typingRefreshDue,
} from "../telegram-typing";

describe("intake typing", () => {
  it("shows typing for a lead message the bot will answer", () => {
    expect(
      shouldShowIntakeTyping({
        text: "Напомни, когда звонок?",
        automationEnabled: true,
        automationPaused: false,
        isLeadConversation: true,
      }),
    ).toBe(true);
  });

  it("stays quiet for commands, paused chats, students, and a disabled switch", () => {
    const base = {
      text: "Когда звонок?",
      automationEnabled: true,
      automationPaused: false,
      isLeadConversation: true,
    };
    expect(shouldShowIntakeTyping({ ...base, text: "/start" })).toBe(false);
    expect(shouldShowIntakeTyping({ ...base, blockedMedia: true })).toBe(false);
    expect(shouldShowIntakeTyping({ ...base, automationPaused: true })).toBe(false);
    expect(shouldShowIntakeTyping({ ...base, isLeadConversation: false })).toBe(false);
    expect(shouldShowIntakeTyping({ ...base, automationEnabled: false })).toBe(false);
  });

  it("refreshes typing on the first poll and then every 4 seconds", () => {
    expect(typingRefreshDue(null, 1_000)).toBe(true);
    expect(typingRefreshDue(1_000, 1_000 + TELEGRAM_TYPING_REFRESH_MS - 1)).toBe(false);
    expect(typingRefreshDue(1_000, 1_000 + TELEGRAM_TYPING_REFRESH_MS)).toBe(true);
  });

  it("asks Hermes again after one second", () => {
    expect(HERMES_POLL_DEFER_MS).toBe(1_000);
  });

  it("posts sendChatAction and skips when the token is missing", async () => {
    const calls: Array<{ url: string; body: string }> = [];
    const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), body: String(init?.body ?? "") });
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }) as typeof fetch;

    await expect(sendTelegramTyping("4242", {}, fetchImpl)).resolves.toBe(false);
    expect(calls).toEqual([]);

    await expect(
      sendTelegramTyping("4242", { TELEGRAM_BOT_TOKEN: "token" }, fetchImpl),
    ).resolves.toBe(true);
    expect(calls[0]?.url).toBe("https://api.telegram.org/bottoken/sendChatAction");
    expect(JSON.parse(calls[0]?.body ?? "{}")).toEqual({ chat_id: "4242", action: "typing" });
  });

  it("sends typing once per refresh window while Hermes is still writing", async () => {
    const sent: string[] = [];
    const db = {
      agentRun: {
        findUnique: async () => ({ conversationId: "conv-1" }),
      },
      conversation: {
        findUnique: async () => ({ leadId: "lead-1", studentId: null }),
      },
      channelIdentity: {
        findFirst: async () => ({ metadataJson: { chat_id: "77" } }),
      },
    };
    const lastSentAt = new Map<string, number>();
    const env = { TELEGRAM_BOT_TOKEN: "token" };
    const fetchImpl = (async (_url: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? "{}")) as { chat_id?: string };
      sent.push(String(body.chat_id));
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }) as typeof fetch;
    await refreshHermesTyping(db as never, "run-1", lastSentAt, 5_000, env, fetchImpl);
    await refreshHermesTyping(db as never, "run-1", lastSentAt, 6_000, env, fetchImpl);
    await refreshHermesTyping(db as never, "run-1", lastSentAt, 9_000, env, fetchImpl);
    expect(sent).toEqual(["77", "77"]);
  });
});
