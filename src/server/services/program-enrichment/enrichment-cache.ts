import { createHash } from "node:crypto";
import { prisma } from "@/lib/db";
import { ENRICHMENT_PROMPT_VERSION } from "./config";

export function buildSourceFingerprint(
  documentHashes: string[],
  promptVersion = ENRICHMENT_PROMPT_VERSION
): string {
  const sorted = [...documentHashes].filter(Boolean).sort();
  return createHash("sha256")
    .update(`${promptVersion}|${sorted.join("|")}`)
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
  return prisma.programEnrichmentRun.findFirst({
    where: {
      programAcademicYearId: input.programAcademicYearId,
      applicantCategory: input.applicantCategory,
      sourceFingerprint: input.sourceFingerprint,
      promptVersion,
      status: "SUCCEEDED",
    },
    orderBy: { finishedAt: "desc" },
  });
}

export async function createEnrichmentRun(input: {
  programAcademicYearId: string;
  applicantCategory: string;
  status: string;
  model?: string | null;
  promptVersion: string;
  sourceFingerprint: string;
  sourceDocumentIdsJson?: string | null;
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
    error?: string | null;
    model?: string | null;
    reusedFromRunId?: string | null;
    sourceFingerprint?: string;
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
      error: data.error,
      model: data.model,
      reusedFromRunId: data.reusedFromRunId,
      sourceFingerprint: data.sourceFingerprint,
      finishedAt: new Date(),
    },
  });
}
