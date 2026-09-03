import { createHash } from "node:crypto";
import { prisma } from "@/lib/db";
import { ENRICHMENT_PROMPT_VERSION } from "./config";

export function buildSourceFingerprint(
  documentHashes: string[],
  _promptVersion = ENRICHMENT_PROMPT_VERSION
): string {
  void _promptVersion;
  const sorted = [...documentHashes].filter(Boolean).sort();
  return createHash("sha256")
    .update(sorted.join("|"))
    .digest("hex")
    .slice(0, 40);
}

export async function findReusableEnrichmentRun(input: {
  programAcademicYearId: string;
  applicantCategory: string;
  sourceFingerprint: string;
  promptVersion?: string;
}) {
  const promptVersion = input.promptVersion ?? ENRICHMENT_PROMPT_VERSION;
  const run = await prisma.programEnrichmentRun.findFirst({
    where: {
      programAcademicYearId: input.programAcademicYearId,
      applicantCategory: input.applicantCategory,
      sourceFingerprint: input.sourceFingerprint,
      promptVersion,
      status: { in: ["SUCCEEDED", "REUSED"] },
    },
    orderBy: { finishedAt: "desc" },
  });
  if (!run?.resolvedFactIdsJson) return null;
  let ids: string[] = [];
  try {
    ids = JSON.parse(run.resolvedFactIdsJson) as string[];
  } catch {
    return null;
  }
  if (ids.length === 0) return null;
  const available = await prisma.programFact.count({
    where: {
      id: { in: ids },
      programAcademicYearId: input.programAcademicYearId,
      superseded: false,
      decisionStatus: "ELIGIBLE",
    },
  });
  return available === ids.length ? run : null;
}

export async function createEnrichmentRun(input: {
  programAcademicYearId: string;
  applicantCategory: string;
  status: string;
  model?: string | null;
  promptVersion: string;
  sourceFingerprint: string;
  sourceDocumentIdsJson?: string | null;
  resolvedFactIdsJson?: string | null;
  origin?: string;
  academicYear?: string | null;
  resolverVersion?: string | null;
  toolCallCount?: number;
  inputTokens?: number | null;
  outputTokens?: number | null;
  quoteRejectCount?: number;
  reusedFromRunId?: string | null;
  error?: string | null;
  finishedAt?: Date | null;
}) {
  return prisma.programEnrichmentRun.create({
    data: {
      programAcademicYearId: input.programAcademicYearId,
      applicantCategory: input.applicantCategory,
      status: input.status,
      model: input.model ?? null,
      promptVersion: input.promptVersion,
      sourceFingerprint: input.sourceFingerprint,
      sourceDocumentIdsJson: input.sourceDocumentIdsJson ?? null,
      resolvedFactIdsJson: input.resolvedFactIdsJson ?? null,
      origin: input.origin ?? "AI",
      academicYear: input.academicYear ?? null,
      resolverVersion: input.resolverVersion ?? null,
      toolCallCount: input.toolCallCount ?? 0,
      inputTokens: input.inputTokens ?? null,
      outputTokens: input.outputTokens ?? null,
      quoteRejectCount: input.quoteRejectCount ?? 0,
      reusedFromRunId: input.reusedFromRunId ?? null,
      error: input.error ?? null,
      finishedAt: input.finishedAt ?? null,
    },
  });
}

export async function finishEnrichmentRun(
  id: string,
  data: {
    status: string;
    toolCallCount?: number;
    inputTokens?: number | null;
    outputTokens?: number | null;
    quoteRejectCount?: number;
    sourceDocumentIdsJson?: string | null;
    resolvedFactIdsJson?: string | null;
    error?: string | null;
    model?: string | null;
    reusedFromRunId?: string | null;
    sourceFingerprint?: string;
    origin?: string;
    resolverVersion?: string | null;
  }
) {
  return prisma.programEnrichmentRun.update({
    where: { id },
    data: {
      status: data.status,
      toolCallCount: data.toolCallCount,
      inputTokens: data.inputTokens,
      outputTokens: data.outputTokens,
      quoteRejectCount: data.quoteRejectCount,
      sourceDocumentIdsJson: data.sourceDocumentIdsJson,
      resolvedFactIdsJson: data.resolvedFactIdsJson,
      error: data.error,
      model: data.model,
      reusedFromRunId: data.reusedFromRunId,
      sourceFingerprint: data.sourceFingerprint,
      origin: data.origin,
      resolverVersion: data.resolverVersion,
      finishedAt: new Date(),
    },
  });
}
