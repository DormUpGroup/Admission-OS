import { prisma } from "@/lib/db";
import type { ApplicantCategory } from "@/lib/program-matching/types";
import { getEnrichmentConfig, isProgramEnrichmentEnabled } from "./config";
import {
  buildSourceFingerprint,
  createEnrichmentRun,
  findReusableEnrichmentRun,
  finishEnrichmentRun,
} from "./enrichment-cache";
import { runLunaTerraEnrichment } from "./luna-terra";
import {
  toMinimalMatchingContext,
  type MinimalMatchingContext,
} from "./matching-context";
import {
  createOpenAiEnrichmentClient,
  type EnrichmentLlmClient,
} from "./openai-client";
import {
  createOfficialSiteNavigator,
  type OfficialSiteNavigator,
} from "./official-site-navigator";
import { persistEnrichmentOutput } from "./persist-enrichment";
import { PROGRAMME_FACT_RESOLVER_VERSION } from "@/server/services/program-matching/programme-fact-contract";

export type AiEnrichResult = {
  status:
    | "DISABLED"
    | "REUSED"
    | "SUCCEEDED"
    | "FAILED"
    | "NO_OFFICIAL_URL";
  runId?: string;
  reused?: boolean;
  model?: string;
  quoteRejectCount?: number;
  toolCallCount?: number;
  error?: string;
  aiEnabled: boolean;
};

export async function enrichProgramWithAi(input: {
  programAcademicYearId: string;
  applicantCategory: ApplicantCategory;
  matchingContext: MinimalMatchingContext;
  client?: EnrichmentLlmClient;
  navigatorFactory?: (args: {
    programId: string;
    universityId: string;
    programAcademicYearId: string;
    academicYear: string;
  }) => OfficialSiteNavigator;
  forShortlist?: boolean;
  force?: boolean;
}): Promise<AiEnrichResult> {
  const cfg = getEnrichmentConfig();
  if (!isProgramEnrichmentEnabled() && !input.client) {
    return { status: "DISABLED", aiEnabled: false };
  }

  const pay = await prisma.programAcademicYear.findUnique({
    where: { id: input.programAcademicYearId },
    include: {
      program: { include: { university: true } },
      sourceDocuments: {
        orderBy: { retrievedAt: "desc" },
        take: 20,
      },
    },
  });
  if (!pay) {
    return { status: "FAILED", aiEnabled: true, error: "pay_not_found" };
  }

  const officialUrl =
    input.matchingContext.program.officialUrl || pay.program.officialUrl;
  if (!officialUrl) {
    const run = await createEnrichmentRun({
      programAcademicYearId: pay.id,
      applicantCategory: input.applicantCategory,
      status: "NO_OFFICIAL_URL",
      promptVersion: cfg.promptVersion,
      sourceFingerprint: "none",
      finishedAt: new Date(),
      error: "missing_official_url",
    });
    return {
      status: "NO_OFFICIAL_URL",
      aiEnabled: true,
      runId: run.id,
    };
  }

  const navigator =
      input.navigatorFactory?.({
        programId: pay.programId,
        universityId: pay.program.universityId,
        programAcademicYearId: pay.id,
        academicYear: pay.academicYear,
      }) ??
      createOfficialSiteNavigator({
        programId: pay.programId,
        universityId: pay.program.universityId,
        programAcademicYearId: pay.id,
        academicYear: pay.academicYear,
      });

  // Refresh the official root before deciding whether old AI output is
  // reusable. A legacy dossier or stale local SourceDocument is never a hit.
  await navigator.inspect_programme_site(officialUrl);
  const preflightDocs = navigator.getDocuments();
  const preflightHashes = [...preflightDocs.values()].map((d) => d.contentHash);
  const prelimFingerprint =
    preflightHashes.length > 0
      ? buildSourceFingerprint(preflightHashes)
      : `unavailable:${Date.now()}`;

  if (!input.force && preflightHashes.length > 0) {
    const reusable = await findReusableEnrichmentRun({
      programAcademicYearId: pay.id,
      applicantCategory: input.applicantCategory,
      sourceFingerprint: prelimFingerprint,
      promptVersion: cfg.promptVersion,
    });
    if (reusable) {
      const run = await createEnrichmentRun({
        programAcademicYearId: pay.id,
        applicantCategory: input.applicantCategory,
        status: "REUSED",
        model: reusable.model,
        promptVersion: cfg.promptVersion,
        sourceFingerprint: prelimFingerprint,
        sourceDocumentIdsJson: reusable.sourceDocumentIdsJson,
        resolvedFactIdsJson: reusable.resolvedFactIdsJson,
        reusedFromRunId: reusable.id,
        origin: "AI",
        academicYear: pay.academicYear,
        resolverVersion: PROGRAMME_FACT_RESOLVER_VERSION,
        finishedAt: new Date(),
      });
      return {
        status: "REUSED",
        aiEnabled: true,
        reused: true,
        runId: run.id,
        model: reusable.model ?? undefined,
      };
    }
  }

  const run = await createEnrichmentRun({
    programAcademicYearId: pay.id,
    applicantCategory: input.applicantCategory,
    status: "RUNNING",
    model: cfg.model,
    promptVersion: cfg.promptVersion,
    sourceFingerprint: prelimFingerprint,
    origin: "AI",
    academicYear: pay.academicYear,
    resolverVersion: PROGRAMME_FACT_RESOLVER_VERSION,
  });

  try {
    const client = input.client ?? createOpenAiEnrichmentClient();
    const ctx: MinimalMatchingContext = {
      ...input.matchingContext,
      program: {
        ...input.matchingContext.program,
        officialUrl,
      },
    };

    const result = await runLunaTerraEnrichment({
      ctx,
      navigator,
      client,
      forShortlist: input.forShortlist,
    });

    const docs = navigator.getDocuments();
    const hashes = [...docs.values()].map((d) => d.contentHash);
    const fingerprint = buildSourceFingerprint(
      hashes.length ? hashes : preflightHashes
    );

    // Cache hit after navigation (shared bando hash)
    if (!input.force && hashes.length) {
      const reusable = await findReusableEnrichmentRun({
        programAcademicYearId: pay.id,
        applicantCategory: input.applicantCategory,
        sourceFingerprint: fingerprint,
        promptVersion: cfg.promptVersion,
      });
      if (reusable && reusable.id !== run.id) {
        await finishEnrichmentRun(run.id, {
          status: "REUSED",
          model: reusable.model,
          sourceDocumentIdsJson: JSON.stringify([...docs.keys()]),
          resolvedFactIdsJson: reusable.resolvedFactIdsJson,
          toolCallCount: result.toolCallCount,
          reusedFromRunId: reusable.id,
          sourceFingerprint: fingerprint,
        });
        return {
          status: "REUSED",
          aiEnabled: true,
          reused: true,
          runId: run.id,
          model: reusable.model ?? undefined,
          toolCallCount: result.toolCallCount,
        };
      }
    }

    if (!result.output) {
      await finishEnrichmentRun(run.id, {
        status: "FAILED",
        model: result.model,
        toolCallCount: result.toolCallCount,
        inputTokens: result.inputTokens,
        outputTokens: result.outputTokens,
        quoteRejectCount: result.quoteRejectCount,
        sourceDocumentIdsJson: JSON.stringify([...docs.keys()]),
        error: "empty_or_invalid_model_output",
      });
      await prisma.programEnrichmentRun.update({
        where: { id: run.id },
        data: { sourceFingerprint: fingerprint },
      });
      return {
        status: "FAILED",
        aiEnabled: true,
        runId: run.id,
        model: result.model,
        error: "empty_or_invalid_model_output",
        toolCallCount: result.toolCallCount,
        quoteRejectCount: result.quoteRejectCount,
      };
    }

    const docTexts = new Map(
      [...docs.entries()].map(([id, d]) => [id, d.text])
    );
    const persisted = await persistEnrichmentOutput({
      programId: pay.programId,
      programAcademicYearId: pay.id,
      academicYear: pay.academicYear,
      applicantCategory: input.applicantCategory,
      output: result.output,
      documentTexts: docTexts,
      extractionMethod: `OPENAI_${result.model}`,
      deferAdministrativeFields: input.forShortlist,
    });

    await finishEnrichmentRun(run.id, {
      status: "SUCCEEDED",
      model: result.model,
      toolCallCount: result.toolCallCount,
      inputTokens: result.inputTokens,
      outputTokens: result.outputTokens,
      quoteRejectCount:
        result.quoteRejectCount + persisted.quoteRejectCount,
      sourceDocumentIdsJson: JSON.stringify([...docs.keys()]),
      resolvedFactIdsJson: JSON.stringify(persisted.savedFactIds),
      resolverVersion: PROGRAMME_FACT_RESOLVER_VERSION,
    });
    await prisma.programEnrichmentRun.update({
      where: { id: run.id },
      data: { sourceFingerprint: fingerprint },
    });

    await prisma.programAcademicYear.update({
      where: { id: pay.id },
      data: {
        dossierEnrichedAt: new Date(),
        dataConfidence:
          persisted.savedFields.length >= 3 ? "MEDIUM" : pay.dataConfidence,
      },
    });

    // Store enrichment disabled/enabled trace fact
    await prisma.programFact.create({
      data: {
        programId: pay.programId,
        programAcademicYearId: pay.id,
        field: "ENRICHMENT_TRACE",
        normalizedValueJson: JSON.stringify({
          aiEnabled: true,
          model: result.model,
          escalated: result.escalated,
          promptVersion: cfg.promptVersion,
          savedFields: persisted.savedFields,
          quoteRejectCount:
            result.quoteRejectCount + persisted.quoteRejectCount,
          runId: run.id,
        }),
        sourceType: "PROGRAMME_PAGE",
        academicYear: pay.academicYear,
        confidence: "LOW",
        extractionMethod: `OPENAI_${result.model}`,
        verificationStatus: "UNVERIFIED",
      },
    });

    return {
      status: "SUCCEEDED",
      aiEnabled: true,
      runId: run.id,
      model: result.model,
      toolCallCount: result.toolCallCount,
      quoteRejectCount:
        result.quoteRejectCount + persisted.quoteRejectCount,
    };
  } catch (e) {
    const message = e instanceof Error ? e.message : "enrichment_failed";
    await finishEnrichmentRun(run.id, {
      status: "FAILED",
      error: message,
    });
    return {
      status: "FAILED",
      aiEnabled: true,
      runId: run.id,
      error: message,
    };
  }
}

export { toMinimalMatchingContext, isProgramEnrichmentEnabled };
