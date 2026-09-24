import { NextResponse } from "next/server";
import { normalizeTelegramUpdate } from "@/server/channels/telegram";
import { ingestTelegramUpdate } from "@/server/commands/telegram-inbound";

export const runtime = "nodejs";

function verifyTelegramSecret(request: Request): boolean {
  const expected = process.env.TELEGRAM_WEBHOOK_SECRET?.trim();
  if (!expected) return false;
  const provided = request.headers.get("x-telegram-bot-api-secret-token");
  return Boolean(provided && provided === expected);
}

export async function POST(request: Request) {
  if (!verifyTelegramSecret(request)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const message = normalizeTelegramUpdate(payload);
  if (!message) {
    // Acknowledge ignored update types so Telegram does not retry.
    return NextResponse.json({ ok: true, ignored: true });
  }

  try {
    const result = await ingestTelegramUpdate({
      rawPayload: payload,
      message,
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    console.error(
      JSON.stringify({
        level: "error",
        msg: "telegram.webhook.ingest_failed",
        error: error instanceof Error ? error.message : String(error),
      }),
    );
    return NextResponse.json({ error: "ingest_failed" }, { status: 500 });
  }
}
