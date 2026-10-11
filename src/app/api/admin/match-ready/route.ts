import { NextResponse } from "next/server";
import { auth } from "@/server/auth";
import { prisma } from "@/lib/db";
import { markNotificationRead } from "@/server/services/notifications";
import {
  PROGRAM_MATCH_READY_TYPE,
  matchReadyHref,
} from "@/server/services/program-matching/match-ready-notice";

export const runtime = "nodejs";

async function requireStaff() {
  const session = await auth();
  if (!session?.user) {
    return { error: NextResponse.json({ error: "unauthorized" }, { status: 401 }) };
  }
  if (session.user.role !== "ADMIN" && session.user.role !== "CURATOR") {
    return { error: NextResponse.json({ error: "forbidden" }, { status: 403 }) };
  }
  return { session };
}

function hrefFromMetadata(metadataJson: string | null, studentId: string | null) {
  if (!metadataJson || !studentId) return null;
  try {
    const meta = JSON.parse(metadataJson) as { href?: unknown; activityId?: unknown };
    if (typeof meta.href === "string" && meta.href.startsWith("/admin/students/")) {
      return meta.href;
    }
    if (typeof meta.activityId === "string" && meta.activityId) {
      return matchReadyHref(studentId, meta.activityId);
    }
  } catch {
    return null;
  }
  return null;
}

export async function GET() {
  const access = await requireStaff();
  if (access.error) return access.error;

  const rows = await prisma.inAppNotification.findMany({
    where: {
      userId: access.session.user.id,
      type: PROGRAM_MATCH_READY_TYPE,
      readAt: null,
    },
    orderBy: { createdAt: "desc" },
    take: 5,
    select: {
      id: true,
      body: true,
      studentId: true,
      metadataJson: true,
    },
  });

  const items = rows.flatMap((row) => {
    const href = hrefFromMetadata(row.metadataJson, row.studentId);
    if (!href) return [];
    return [{ id: row.id, text: row.body, href }];
  });

  return NextResponse.json({ items });
}

export async function POST(req: Request) {
  const access = await requireStaff();
  if (access.error) return access.error;

  const body = (await req.json().catch(() => null)) as { id?: unknown } | null;
  const id = typeof body?.id === "string" ? body.id : "";
  if (!id) {
    return NextResponse.json({ error: "missing_id" }, { status: 400 });
  }

  await markNotificationRead(id, access.session.user.id);
  return NextResponse.json({ ok: true });
}
