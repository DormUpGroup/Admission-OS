import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { normalizeTelegramUpdate } from "@/server/channels/telegram";
import { handleAppointmentCallback } from "@/server/commands/appointment-callbacks";
import { ingestTelegramUpdate } from "@/server/commands/telegram-inbound";
import { tryDeliverTelegramSendNow } from "@/server/delivery/telegram-inline";

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

  const update = normalizeTelegramUpdate(payload);
  if (!update) {
    return NextResponse.json({ ok: true, ignored: true });
  }

  try {
    if (update.kind === "callback") {
      const result = await handleAppointmentCallback({
        callbackQueryId: update.callbackQueryId,
        data: update.data,
      });
      return NextResponse.json({ ok: true, callback: true, ...result });
    }

    const result = await ingestTelegramUpdate({
      rawPayload: payload,
      message: update,
    });
    if (!result.duplicate) {
      const pending = await prisma.conversationMessage.findMany({
        where: {
          conversationId: result.conversationId,
          direction: "OUTBOUND",
          deliveryStatus: { in: ["PENDING", "PROCESSING"] },
        },
        select: { id: true },
        orderBy: { createdAt: "asc" },
        take: 8,
      });
      const messageIds = [
        ...new Set([
          ...result.outboundMessageIds,
          ...pending.map((row) => row.id),
        ]),
      ];
      for (const messageId of messageIds) {
        await tryDeliverTelegramSendNow(messageId).catch((error) => {
          console.warn(
            JSON.stringify({
              level: "warn",
              msg: "telegram.send.bot_inline_failed",
              messageId,
              error: error instanceof Error ? error.message : String(error),
            }),
          );
        });
      }
    }
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
