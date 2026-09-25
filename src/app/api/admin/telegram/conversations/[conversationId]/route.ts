import { NextResponse } from "next/server";
import { auth } from "@/server/auth";
import { loadTelegramThread } from "@/server/telegram-inbox-query";

export const runtime = "nodejs";

export async function GET(
  _req: Request,
  context: { params: Promise<{ conversationId: string }> },
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (session.user.role !== "ADMIN" && session.user.role !== "CURATOR") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const { conversationId } = await context.params;
  if (!conversationId?.trim()) {
    return NextResponse.json({ error: "missing_id" }, { status: 400 });
  }

  const thread = await loadTelegramThread(conversationId.trim());
  if (!thread) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  return NextResponse.json(thread, {
    headers: { "Cache-Control": "no-store" },
  });
}
