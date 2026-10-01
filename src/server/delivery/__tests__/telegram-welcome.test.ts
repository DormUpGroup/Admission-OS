import { afterEach, describe, expect, it, vi } from "vitest";
import type { NormalizedTelegramMessage } from "@/server/channels/telegram";
import { telegramWelcomeText } from "@/server/channels/telegram-copy";
import { sendTelegramChatText } from "@/server/delivery/telegram";
import { beginInstantWelcome } from "@/server/delivery/telegram-welcome";

function startMessage(text = "/start"): NormalizedTelegramMessage {
  return {
    kind: "message",
    providerEventId: "1",
    providerMessageId: "2",
    externalUserId: "100",
    externalChatId: "100",
    username: "maria",
    displayName: "Мария Иванова",
    text,
    attachments: [],
  };
}

describe("instant /start greeting", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("posts the template with the first name and does not wait on a model", async () => {
    const fetchImpl = vi.fn(async () => {
      return new Response(JSON.stringify({ ok: true, result: { message_id: 42 } }), { status: 200 });
    });
    const body = telegramWelcomeText("Мария Иванова");
    const id = await sendTelegramChatText("100", body, { TELEGRAM_BOT_TOKEN: "token" }, fetchImpl);
    expect(id).toBe("42");
    const call = fetchImpl.mock.calls[0];
    expect(String(call?.[0])).toContain("/sendMessage");
    const payload = JSON.parse(String((call?.[1] as RequestInit).body));
    expect(payload.chat_id).toBe("100");
    expect(payload.text).toBe(telegramWelcomeText("Мария Иванова"));
  });

  it("leaves ordinary messages and a disabled bot on the slow path", async () => {
    vi.stubEnv("AUTOMATION_ENABLED", "false");
    expect(await beginInstantWelcome(startMessage())).toBeNull();
    vi.stubEnv("AUTOMATION_ENABLED", "true");
    vi.stubEnv("TELEGRAM_BOT_TOKEN", "token");
    expect(await beginInstantWelcome(startMessage("Хочу в магистратуру"))).toBeNull();
  });
});
