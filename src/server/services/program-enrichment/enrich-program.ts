import { prisma } from "@/lib/db";
import type { ApplicantCategory } from "@/lib/program-matching/types";
import { getEnrichmentConfig, isProgramEnrichmentEnabled } from "./config";
import {
  buildSourceFingerprint,
  createEnrichmentRun,
  findReusableEnrichmentRun,
  finishEnrichmentRun,
} from "./enrichment-cache";
import {
  findEligibleFactsForCurrentSources,
  enrichmentFieldsForMode,
} from "./eligible-facts";
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
  type NavigatorPage,
} from "./official-site-navigator";
import { persistEnrichmentOutput } from "./persist-enrichment";
import { PROGRAMME_FACT_RESOLVER_VERSION } from "@/server/services/program-matching/programme-fact-contract";
import { reconcileAdmissionExamsFromStoredSources } from "@/server/services/program-ingestion/exam-evidence-reconciliation";
import { planProgrammePageDiscovery } from "@/server/services/program-ingestion/programme-page-discovery";

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

/**
 * Fetch the two strongest official admission links before handing control to
 * the model. This is deterministic evidence collection, not a model choice:
 * a card may never conclude "source needs checking" while its programme page
 * already exposes an Admission requirements / Enrolment route.
 */
async function prefetchAdmissionLinks(
  navigator: OfficialSiteNavigator,
  pageId?: string
) {
  const priority = (link: { classification: string; label: string; url: string }) => {
    const hay = `${link.label} ${link.url}`.toLowerCase();
    let score =
      link.classification === "requirements"
        ? 80
        : link.classification === "enrol"
          ? 70
          : link.classification === "bando"
            ? 60
            : link.classification === "pdf"
              ? 40
            : 0;
    if (/exam|test|tolc|imat|sat|act|concorso|selezione|call.?for.?application/.test(hay)) score += 40;
    if (/admission requirements?|enrol(?:ment)?|immatricol|iscriv/.test(hay)) score += 30;
    return score;
  };
  const candidates = [...navigator.getAllowedLinks().values()]
    .filter((link) => !pageId || link.pageId === pageId)
    .filter((link) => priority(link) > 0)
    .sort((a, b) => priority(b) - priority(a))
    .slice(0, 2);

  for (const link of candidates) {
    if (link.classification === "pdf") {
      await navigator.read_official_pdf(link.linkId);
    } else {
      await navigator.follow_official_link(link.linkId);
    }
  }
}

function isNavigatorPage(
  page: Awaited<ReturnType<OfficialSiteNavigator["inspect_programme_site"]>>
): page is NavigatorPage {
  return "pageId" in page;
}

/**
 * Universitaly occasionally supplies a university home page as officialUrl.
 * Follow only an exact named course link, optionally through one course
 * catalogue page. This is deterministic so a model can never choose a
 * similarly named but different programme.
 */
async function resolveProgrammePage(
  navigator: OfficialSiteNavigator,
  root: NavigatorPage,
  programmeNames: Array<string | null | undefined>
): Promise<{ page: NavigatorPage; resolved: boolean }> {
  const planFor = (page: NavigatorPage) =>
    planProgrammePageDiscovery({
      pageUrl: page.url,
      pageTitle: page.title,
      links: page.links,
      programmeNames,
    });
  const first = planFor(root);
  if (first.kind === "already_programme_page") {
    return { page: root, resolved: true };
  }
  if (first.kind === "not_found") {
    return { page: root, resolved: false };
  }
  if (first.kind === "direct_link") {
    const page = await navigator.follow_official_link(first.link.linkId);
    return isNavigatorPage(page)
      ? { page, resolved: true }
      : { page: root, resolved: false };
  }

  for (const catalogue of first.links) {
    const cataloguePage = await navigator.follow_official_link(catalogue.linkId);
    if (!isNavigatorPage(cataloguePage)) continue;
    const nested = planFor(cataloguePage);
    if (nested.kind === "already_programme_page") {
      return { page: cataloguePage, resolved: true };
    }
    if (nested.kind !== "direct_link") continue;
    const programmePage = await navigator.follow_official_link(nested.link.linkId);
    if (isNavigatorPage(programmePage)) {
      return { page: programmePage, resolved: true };
    }
  }
  return { page: root, resolved: false };
}

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
  const rootPage = await navigator.inspect_programme_site(officialUrl);
  const programmeResolution = isNavigatorPage(rootPage)
    ? await resolveProgrammePage(navigator, rootPage, [
        pay.program.name,
        pay.program.titleOfficial,
        pay.program.titleEnglish,
      ])
    : null;
  if (programmeResolution && !programmeResolution.resolved) {
    return {
      status: "FAILED",
      aiEnabled: true,
      error: "programme_page_not_found",
      toolCallCount: navigator.toolCallCount(),
    };
  }
  const programmePage = programmeResolution?.page ?? null;
  const resolvedOfficialUrl = programmePage?.url ?? officialUrl;
  if (resolvedOfficialUrl !== officialUrl) {
    await prisma.program.update({
      where: { id: pay.programId },
      data: { officialUrl: resolvedOfficialUrl },
    });
  }
  await prefetchAdmissionLinks(navigator, programmePage?.pageId);
  // Close the source-to-card gap before checking the cache. Older successful
  // runs may have fetched a page with a named exam but never materialized that
  // fact; the deterministic reconciliation can safely recover it from the
  // exact official quote without another model call.
  await reconcileAdmissionExamsFromStoredSources(pay.id);
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
        officialUrl: resolvedOfficialUrl,
      },
    };

    const docs = navigator.getDocuments();
    const currentDocIds = [...docs.keys()];
    const hashes = [...docs.values()].map((d) => d.contentHash);
    const fingerprint = buildSourceFingerprint(
      hashes.length ? hashes : preflightHashes
    );

    const eligible = await findEligibleFactsForCurrentSources({
      programAcademicYearId: pay.id,
      applicantCategory: input.applicantCategory,
      academicYear: pay.academicYear,
      sourceDocumentIds: currentDocIds,
      forShortlist: input.forShortlist,
    });
    const needed = enrichmentFieldsForMode(input.forShortlist ?? false);
    const alreadyResolved = eligible.coveredFields;
    if (
      needed.length > 0 &&
      needed.every((field) => alreadyResolved.includes(field)) &&
      eligible.factIds.length > 0
    ) {
      await finishEnrichmentRun(run.id, {
        status: "REUSED",
        sourceDocumentIdsJson: JSON.stringify(currentDocIds),
        resolvedFactIdsJson: JSON.stringify(eligible.factIds),
        toolCallCount: navigator.toolCallCount(),
        sourceFingerprint: fingerprint,
        origin: "AI",
      });
      return {
        status: "REUSED",
        aiEnabled: true,
        reused: true,
        runId: run.id,
        toolCallCount: navigator.toolCallCount(),
      };
    }

    const result = await runLunaTerraEnrichment({
      ctx,
      navigator,
      client,
      forShortlist: input.forShortlist,
      alreadyResolvedFields: alreadyResolved,
    });

    const docsAfter = navigator.getDocuments();
    const hashesAfter = [...docsAfter.values()].map((d) => d.contentHash);
    const fingerprintAfter = buildSourceFingerprint(
      hashesAfter.length ? hashesAfter : preflightHashes
    );

    // Cache hit after navigation (shared bando hash)
    if (!input.force && hashesAfter.length) {
      const reusable = await findReusableEnrichmentRun({
        programAcademicYearId: pay.id,
        applicantCategory: input.applicantCategory,
        sourceFingerprint: fingerprintAfter,
        promptVersion: cfg.promptVersion,
      });
      if (reusable && reusable.id !== run.id) {
        await finishEnrichmentRun(run.id, {
          status: "REUSED",
          model: reusable.model,
          sourceDocumentIdsJson: JSON.stringify([...docsAfter.keys()]),
          resolvedFactIdsJson: reusable.resolvedFactIdsJson,
          toolCallCount: result.toolCallCount,
          reusedFromRunId: reusable.id,
          sourceFingerprint: fingerprintAfter,
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
      // A failed model response must not discard official documents it already
      // inspected. Fall back to the deterministic, quote-validated pipeline;
      // it writes the same individual ELIGIBLE facts read by the dossier.
      const { deepEnrichProgram } = await import(
        "@/server/services/program-ingestion/program-deep-enrich"
      );
      const fallback = await deepEnrichProgram(pay.id, {
        deferAdministrativeFields: input.forShortlist,
      });
      if (fallback.ok) {
        await reconcileAdmissionExamsFromStoredSources(pay.id);
      }
      const fallbackDocuments = await prisma.sourceDocument.findMany({
        where: { programAcademicYearId: pay.id },
        select: { id: true, contentHash: true },
      });
      const fallbackFacts = fallback.ok
        ? await prisma.programFact.findMany({
            where: {
              programAcademicYearId: pay.id,
              superseded: false,
              decisionStatus: "ELIGIBLE",
              origin: "OFFICIAL_FALLBACK",
            },
            select: { id: true },
          })
        : [];
      const fallbackFingerprint = buildSourceFingerprint(
        fallbackDocuments.map((document) => document.contentHash)
      );
      await finishEnrichmentRun(run.id, {
        status: fallback.ok ? "SUCCEEDED" : "FAILED",
        model: fallback.ok ? "FALLBACK_REGEX" : result.model,
        toolCallCount: result.toolCallCount,
        inputTokens: result.inputTokens,
        outputTokens: result.outputTokens,
        quoteRejectCount: result.quoteRejectCount,
        sourceDocumentIdsJson: JSON.stringify(
          fallbackDocuments.map((document) => document.id)
        ),
        resolvedFactIdsJson: JSON.stringify(
          fallbackFacts.map((fact) => fact.id)
        ),
        sourceFingerprint: fallbackFingerprint,
        origin: fallback.ok ? "OFFICIAL_FALLBACK" : "AI",
        error: fallback.ok ? null : "empty_or_invalid_model_output",
      });
      return {
        status: fallback.ok ? "SUCCEEDED" : "FAILED",
        aiEnabled: true,
        runId: run.id,
        model: fallback.ok ? "FALLBACK_REGEX" : result.model,
        error: fallback.ok ? undefined : "empty_or_invalid_model_output",
        toolCallCount: result.toolCallCount,
        quoteRejectCount: result.quoteRejectCount,
      };
    }

    const docTexts = new Map(
      [...docsAfter.entries()].map(([id, d]) => [id, d.text])
    );
    const documentSourceTypes = new Map(
      [...docsAfter.entries()].map(([id, d]) => [id, d.sourceType])
    );
    const persisted = await persistEnrichmentOutput({
      programId: pay.programId,
      programAcademicYearId: pay.id,
      academicYear: pay.academicYear,
      applicantCategory: input.applicantCategory,
      output: result.output,
      documentTexts: docTexts,
      documentSourceTypes,
      extractionMethod: `OPENAI_${result.model}`,
      deferAdministrativeFields: input.forShortlist,
    });
    await reconcileAdmissionExamsFromStoredSources(pay.id);

    await finishEnrichmentRun(run.id, {
      status: "SUCCEEDED",
      model: result.model,
      toolCallCount: result.toolCallCount,
      inputTokens: result.inputTokens,
      outputTokens: result.outputTokens,
      quoteRejectCount:
        result.quoteRejectCount + persisted.quoteRejectCount,
      sourceDocumentIdsJson: JSON.stringify([...docsAfter.keys()]),
      resolvedFactIdsJson: JSON.stringify(persisted.savedFactIds),
      resolverVersion: PROGRAMME_FACT_RESOLVER_VERSION,
    });
    await prisma.programEnrichmentRun.update({
      where: { id: run.id },
      data: { sourceFingerprint: fingerprintAfter },
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
    // Transport failures must not leave a half-built card. Run the same
    // quote-validated deterministic path used for an empty AI response.
    try {
      const { deepEnrichProgram } = await import(
        "@/server/services/program-ingestion/program-deep-enrich"
      );
      const fallback = await deepEnrichProgram(pay.id, {
        deferAdministrativeFields: input.forShortlist,
      });
      if (fallback.ok) {
        await reconcileAdmissionExamsFromStoredSources(pay.id);
        const [documents, facts] = await Promise.all([
          prisma.sourceDocument.findMany({
            where: { programAcademicYearId: pay.id },
            select: { id: true, contentHash: true },
          }),
          prisma.programFact.findMany({
            where: {
              programAcademicYearId: pay.id,
              superseded: false,
              decisionStatus: "ELIGIBLE",
              origin: "OFFICIAL_FALLBACK",
            },
            select: { id: true },
          }),
        ]);
        await finishEnrichmentRun(run.id, {
          status: "SUCCEEDED",
          model: "FALLBACK_REGEX",
          sourceDocumentIdsJson: JSON.stringify(documents.map((d) => d.id)),
          resolvedFactIdsJson: JSON.stringify(facts.map((fact) => fact.id)),
          sourceFingerprint: buildSourceFingerprint(
            documents.map((document) => document.contentHash)
          ),
          origin: "OFFICIAL_FALLBACK",
          error: message,
        });
        return {
          status: "SUCCEEDED",
          aiEnabled: true,
          runId: run.id,
          model: "FALLBACK_REGEX",
          error: message,
        };
      }
    } catch {
      // Preserve the original model error below; fallback diagnostics are
      // already stored by deep enrichment when available.
    }
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
