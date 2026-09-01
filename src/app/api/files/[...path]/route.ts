import { NextResponse } from "next/server";
import path from "path";
import { auth } from "@/server/auth";
import { prisma } from "@/lib/db";
import { readDocumentFile } from "@/lib/storage";
import { canAccessStudent } from "@/server/auth/guards";
import {
  contentTypeForFilename,
  isMessageAttachmentStoragePath,
} from "@/lib/message-attachments";

function fileResponse(data: Buffer, filename: string) {
  return new NextResponse(new Uint8Array(data), {
    status: 200,
    headers: {
      "Content-Type": contentTypeForFilename(filename),
      "Content-Disposition": `inline; filename="${encodeURIComponent(filename)}"`,
      "Cache-Control": "private, no-store",
    },
  });
}

export async function GET(
  _req: Request,
  context: { params: Promise<{ path: string[] }> }
) {
  const session = await auth();
  if (!session?.user) {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  const { path: parts } = await context.params;
  if (!parts?.length) {
    return new NextResponse("Not found", { status: 404 });
  }

  const storagePath = parts.map((p) => decodeURIComponent(p)).join("/");
  if (
    storagePath.includes("..") ||
    path.isAbsolute(storagePath) ||
    storagePath.startsWith("/") ||
    storagePath.startsWith("\\")
  ) {
    return new NextResponse("Forbidden", { status: 403 });
  }

  const document = await prisma.document.findFirst({
    where: { storagePath },
    select: { id: true, studentId: true, name: true, storagePath: true },
  });

  if (document?.storagePath) {
    const { allowed } = await canAccessStudent(document.studentId);
    if (!allowed) {
      return new NextResponse("Forbidden", { status: 403 });
    }
    try {
      const data = await readDocumentFile(document.storagePath);
      return fileResponse(data, document.name || document.storagePath);
    } catch {
      return new NextResponse("Not found", { status: 404 });
    }
  }

  if (!isMessageAttachmentStoragePath(storagePath)) {
    return new NextResponse("Not found", { status: 404 });
  }

  const studentId = parts[0];
  const { allowed } = await canAccessStudent(studentId);
  if (!allowed) {
    return new NextResponse("Forbidden", { status: 403 });
  }

  try {
    const data = await readDocumentFile(storagePath);
    return fileResponse(data, parts[parts.length - 1] || "file");
  } catch {
    return new NextResponse("Not found", { status: 404 });
  }
}
