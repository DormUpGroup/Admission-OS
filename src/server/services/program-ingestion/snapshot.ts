import { createHash } from "crypto";
import { mkdir, writeFile } from "fs/promises";
import path from "path";
import { prisma } from "@/lib/db";
import {
  FETCH_RATE_LIMIT_MS,
  PARSER_VERSION,
  SOURCE_STORAGE_ROOT,
} from "@/lib/program-matching/config";
import { detectStaleness } from "@/server/services/program-matching/source-resolver";

let lastFetchAt = 0;

export async function rateLimitedFetch(url: string, init?: RequestInit) {
  const wait = FETCH_RATE_LIMIT_MS - (Date.now() - lastFetchAt);
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastFetchAt = Date.now();
  const res = await fetch(url, {
    ...init,
    headers: {
      "User-Agent": "ImmigromeOSProgramIngest/1.0 (+public-data-only)",
      ...(init?.headers || {}),
    },
  });
  return res;
}

export function contentHash(content: string | Buffer) {
  return createHash("sha256").update(content).digest("hex");
}

export async function storeRawSnapshot(input: {
  key: string;
  content: string | Buffer;
}) {
  const fullPath = path.join(process.cwd(), SOURCE_STORAGE_ROOT, input.key);
  await mkdir(path.dirname(fullPath), { recursive: true });
  await writeFile(fullPath, input.content);
  return input.key;
}

export async function upsertSourceDocument(input: {
  sourceType: string;
  sourceAuthority?: string;
  url: string;
  title?: string;
  academicYear?: string;
  universityId?: string;
  programId?: string;
  programAcademicYearId?: string;
  contentType?: string;
  body: string;
  publishedAt?: Date | null;
  extractionQuality?: string | null;
  status?: string;
}) {
  const hash = contentHash(input.body);
  const existing = await prisma.sourceDocument.findFirst({
    where: { url: input.url, academicYear: input.academicYear ?? null },
    orderBy: { retrievedAt: "desc" },
  });

  if (existing && existing.contentHash === hash) {
    return { document: existing, changed: false };
  }

  const storageKey = `${input.sourceType}/${hash.slice(0, 16)}.txt`;
  await storeRawSnapshot({ key: storageKey, content: input.body });

  if (existing && existing.contentHash !== hash) {
    await prisma.programChangeEvent.create({
      data: {
        sourceDocumentId: existing.id,
        programId: input.programId,
        programAcademicYearId: input.programAcademicYearId,
        field: "SOURCE_CONTENT",
        oldValue: existing.contentHash,
        newValue: hash,
        severity: "WARNING",
      },
    });
  }

  const document = await prisma.sourceDocument.create({
    data: {
      sourceType: input.sourceType,
      sourceAuthority: input.sourceAuthority,
      url: input.url,
      title: input.title,
      academicYear: input.academicYear,
      universityId: input.universityId,
      programId: input.programId,
      programAcademicYearId: input.programAcademicYearId,
      contentType: input.contentType ?? "html",
      contentHash: hash,
      rawStoragePath: storageKey,
      rawText: input.body.slice(0, 20000),
      parserVersion: PARSER_VERSION,
      status: input.status ?? "FETCHED",
      extractionQuality: input.extractionQuality,
      publishedAt: input.publishedAt ?? null,
    },
  });

  return { document, changed: !!existing };
}

export async function alertShortlistedOnChange(input: {
  programId: string;
  programAcademicYearId?: string;
  field: string;
  oldValue?: string;
  newValue?: string;
}) {
  const shortlisted = await prisma.studentShortlistItem.findMany({
    where: input.programAcademicYearId
      ? { programAcademicYearId: input.programAcademicYearId }
      : {
          programAcademicYear: { programId: input.programId },
        },
  });

  for (const item of shortlisted) {
    await prisma.activity.create({
      data: {
        type: "PROGRAM_SOURCE_CHANGED",
        studentId: item.studentId,
        metadata: JSON.stringify({
          note: "Admission information changed. Curator verification required.",
          field: input.field,
          oldValue: input.oldValue,
          newValue: input.newValue,
          programAcademicYearId: item.programAcademicYearId,
        }),
      },
    });

    await prisma.programMatch.updateMany({
      where: {
        studentId: item.studentId,
        programAcademicYearId: item.programAcademicYearId,
        curatorStatus: { in: ["APPROVED", "SHORTLISTED", "SELECTED"] },
      },
      data: { curatorStatus: "NEEDS_REVIEW" },
    });
  }
}

export function isSourceStale(retrievedAt: Date | null) {
  return detectStaleness(retrievedAt);
}
