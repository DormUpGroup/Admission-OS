import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { handleMcpPost } from "@/server/automation/mcp-server";

export const runtime = "nodejs";

export async function POST(request: Request) {
  let body: unknown = null;
  try {
    body = await request.json();
  } catch {
    body = null;
  }

  const url = new URL(request.url);
  const result = await handleMcpPost({
    db: prisma,
    authorizationHeader: request.headers.get("authorization"),
    profile: request.headers.get("x-admission-profile") ?? url.searchParams.get("profile"),
    body,
  });

  if (result.body == null) {
    return new NextResponse(null, { status: result.status });
  }
  return NextResponse.json(result.body, { status: result.status });
}
