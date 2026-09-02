import { prisma } from "@/lib/db";
import {
  MATCH_LIMIT_MIN,
  UNIVERSITALY_MAX_PAGES,
  UNIVERSITALY_MAX_PAGES_EXTENDED,
  UNIVERSITALY_SEARCH_CACHE_HOURS,
  UNIVERSITALY_SYNONYM_FALLBACK_MIN_CANDIDATES,
} from "@/lib/program-matching/config";
import type { MatchingProfile } from "@/lib/program-matching/types";
import { tagsFromText } from "@/lib/program-matching/taxonomy";
import {
  searchCorsi,
  type UniversitalyCorso,
  type UniversitalySearchQuery,
} from "@/server/services/program-ingestion/universitaly-client";
import { upsertUniversitalyCandidates } from "@/server/services/program-ingestion/universitaly-upsert";
import {
  emptyGateHistogram,
  isCandidateRelevant,
  type GateRejectionHistogram,
} from "@/server/services/program-matching/candidate-relevance";
import {
  allocatePagesRoundRobin,
  corsoMatchesCities,
  mapProfileToUniversitalyQuery,
  orderPrimaryQueriesForThinPoolRetry,
  shouldRetrySingleCycleDurata6,
  splitCoverageByAllocation,
  type PlannedUniversitalyQuery,
} from "@/server/services/program-matching/universitaly-query";

export type CoverageItem = {
  classeCode?: string;
  lingua?: string;
  durata?: string;
  sourceDirections: string[];
  pagesAllocated: number;
  reason?: string;
};

/** Compact corso snapshot for baseline / curator telemetry — does not affect gating. */
export type DiscoverySample = {
  name: string | null;
  university: string | null;
  city: string | null;
  degreeClass: string | null;
};

export type LiveSearchMeta = {
  source: "universitaly-live" | "universitaly-cache";
  fingerprint: string;
  pagesFetched: number;
  totalResults: number;
  candidateCount: number;
  /** Set after persistProgramMatches light-enrich pass. */
  enrichedCount: number;
  truncated: boolean;
  errors: string[];
  warning: string | null;
  programAcademicYearIds: string[];
  directionsSearched?: string[];
  directionsSelected?: string[];
  classeQueries?: Array<{
    classeCode?: string;
    lingua?: string;
    durata?: string;
    sourceDirections: string[];
    pagesAllocated: number;
  }>;
  coverage?: {
    queried: CoverageItem[];
    deferred: CoverageItem[];
  };
  /** True when synonym searchText ran after soft-gate relevant count was low. */
  usedSynonymFallback?: boolean;
  relevantBeforeSynonym?: number;
  relevantAfterSynonym?: number;
  durataFallbackTried?: boolean;
  miurCodes?: Array<{
    code: string;
    role: string;
    directions: string[];
  }>;
  /** Telemetry only: pool sizes around city filter / soft-gate / synonym. */
  rawCount?: number;
  afterCityFilterCount?: number;
  afterSoftGateCount?: number;
  afterSynonymCount?: number;
  preGateSample?: DiscoverySample[];
  postGateSample?: DiscoverySample[];
  gateHistogram?: GateRejectionHistogram;
  queryResults?: Array<{
    classeCode?: string;
    lingua?: string;
    durata?: string;
    sourceDirections: string[];
    pagesAllocated: number;
    pagesFetched: number;
    raw: number;
    passedGate: number;
    role?: string;
  }>;
  thinPoolRetry?: boolean;
};

const SAMPLE_CAP = 20;

function corsoSample(c: UniversitalyCorso): DiscoverySample {
  const extra = c as UniversitalyCorso & {
    nomeInglese?: string;
    nomeIta?: string;
  };
  return {
    name:
      extra.nomeInglese ||
      extra.nomeIta ||
      c.nomeCorsoEn ||
      c.nomeCorso ||
      null,
    university: c.nomeStruttura ?? null,
    city: c.sede?.comuneDescrizione ?? null,
    degreeClass: c.classe?.codice ?? null,
  };
}

type CachePayload = {
  fingerprint: string;
  programAcademicYearIds: string[];
  source: string;
  liveMeta?: Partial<LiveSearchMeta>;
};

function parseCache(metadata: string | null): CachePayload | null {
  if (!metadata) return null;
  try {
    const v = JSON.parse(metadata) as Record<string, unknown>;
    if (typeof v.fingerprint !== "string") return null;
    if (!Array.isArray(v.programAcademicYearIds)) return null;
    return {
      fingerprint: v.fingerprint,
      programAcademicYearIds: v.programAcademicYearIds.map(String),
      source: String(v.source ?? ""),
      liveMeta: {
        rawCount: typeof v.rawCount === "number" ? v.rawCount : undefined,
        afterCityFilterCount:
          typeof v.afterCityFilterCount === "number"
            ? v.afterCityFilterCount
            : undefined,
        afterSoftGateCount:
          typeof v.afterSoftGateCount === "number"
            ? v.afterSoftGateCount
            : undefined,
        afterSynonymCount:
          typeof v.afterSynonymCount === "number"
            ? v.afterSynonymCount
            : undefined,
        usedSynonymFallback: Boolean(v.usedSynonymFallback),
        coverage: v.coverage as LiveSearchMeta["coverage"],
        gateHistogram: v.gateHistogram as GateRejectionHistogram,
        queryResults: v.queryResults as LiveSearchMeta["queryResults"],
        preGateSample: v.preGateSample as DiscoverySample[],
        postGateSample: v.postGateSample as DiscoverySample[],
        warning: typeof v.warning === "string" ? v.warning : null,
        pagesFetched: typeof v.pagesFetched === "number" ? v.pagesFetched : 0,
        directionsSearched: Array.isArray(v.directionsSearched)
          ? v.directionsSearched.map(String)
          : undefined,
        miurCodes: v.miurCodes as LiveSearchMeta["miurCodes"],
      },
    };
  } catch {
    return null;
  }
}

async function findRecentCache(
  studentId: string,
  fingerprint: string
): Promise<CachePayload | null> {
  const since = new Date(
    Date.now() - UNIVERSITALY_SEARCH_CACHE_HOURS * 60 * 60 * 1000
  );
  const activities = await prisma.activity.findMany({
    where: {
      studentId,
      type: "PROGRAM_MATCH_GENERATED",
      createdAt: { gte: since },
    },
    orderBy: { createdAt: "desc" },
    take: 10,
  });

  for (const a of activities) {
    const cache = parseCache(a.metadata);
    if (!cache || cache.fingerprint !== fingerprint) continue;
    if (cache.programAcademicYearIds.length === 0) continue;

    const existing = await prisma.programAcademicYear.count({
      where: { id: { in: cache.programAcademicYearIds } },
    });
    if (existing > 0) return cache;
  }
  return null;
}

function corsoName(c: UniversitalyCorso): string | null {
  const extra = c as UniversitalyCorso & {
    nomeInglese?: string;
    nomeIta?: string;
  };
  return extra.nomeInglese || extra.nomeIta || c.nomeCorsoEn || c.nomeCorso || null;
}

function corsoFieldTags(c: UniversitalyCorso): string[] {
  const extra = c as UniversitalyCorso & {
    nomeInglese?: string;
    nomeIta?: string;
  };
  const name =
    extra.nomeInglese ||
    extra.nomeIta ||
    c.nomeCorsoEn ||
    c.nomeCorso ||
    "";
  return tagsFromText(`${name} ${c.classe?.descrizione ?? ""}`);
}

function gateCorsi(
  corsi: UniversitalyCorso[],
  selectedClasses: string[],
  selectedDirections: string[],
  miurCodes?: Array<{ code: string; role: "primary" | "secondary"; directions: string[] }>
): { passed: UniversitalyCorso[]; histogram: GateRejectionHistogram } {
  const histogram = emptyGateHistogram();
  const passed: UniversitalyCorso[] = [];
  for (const c of corsi) {
    const { relevant } = isCandidateRelevant({
      degreeClass: c.classe?.codice ?? null,
      name: corsoName(c),
      fieldTags: corsoFieldTags(c),
      selectedClasses,
      selectedDirections,
      miurCodes,
    });
    if (relevant) {
      passed.push(c);
      histogram.passed += 1;
    } else {
      histogram.no_classe_no_tag += 1;
    }
  }
  return { passed, histogram };
}

async function runAllocatedQueries(
  queries: PlannedUniversitalyQuery[],
  pageAllocations: number[],
  degreeLevel: string
): Promise<{
  byId: Map<string, UniversitalyCorso>;
  pagesFetched: number;
  totalResults: number;
  truncated: boolean;
  errors: string[];
  durataFallbackTried: boolean;
  pagesUsed: number[];
  queryResults: NonNullable<LiveSearchMeta["queryResults"]>;
}> {
  const byId = new Map<string, UniversitalyCorso>();
  let pagesFetched = 0;
  let totalResults = 0;
  let truncated = false;
  let durataFallbackTried = false;
  const errors: string[] = [];
  const pagesUsed = [...pageAllocations];
  const queryResults: NonNullable<LiveSearchMeta["queryResults"]> = [];

  for (let i = 0; i < queries.length; i++) {
    const maxPages = pageAllocations[i] ?? 0;
    const query = queries[i];
    let queryRaw = 0;
    let queryPagesFetched = 0;
    if (maxPages <= 0) {
      queryResults.push({
        classeCode: query.classeCode,
        lingua: query.lingua,
        durata: query.durata,
        sourceDirections: query.sourceDirections ?? [],
        pagesAllocated: 0,
        pagesFetched: 0,
        raw: 0,
        passedGate: 0,
        role: query.roles?.join(",") ?? undefined,
      });
      continue;
    }
    const search = await searchCorsi(query, { maxPages });
    queryPagesFetched += search.pagesFetched;
    pagesFetched += search.pagesFetched;
    totalResults += search.totalResults;
    if (search.truncated) truncated = true;
    errors.push(...search.errors);
    for (const c of search.corsi) {
      byId.set(String(c.id), c);
      queryRaw += 1;
    }

    const code = query.classeCode;
    const canFallback = shouldRetrySingleCycleDurata6({
      classeCode: code,
      degreeLevel,
      durata: query.durata,
      emptyResults: search.corsi.length === 0,
    }) && search.pagesFetched < maxPages;

    if (canFallback) {
      durataFallbackTried = true;
      query.durataFallbackTried = true;
      const retryBudget = maxPages - search.pagesFetched;
      if (retryBudget > 0) {
        const retry = await searchCorsi(
          { ...query, durata: "6" },
          { maxPages: retryBudget }
        );
        queryPagesFetched += retry.pagesFetched;
        pagesFetched += retry.pagesFetched;
        pagesUsed[i] = (pagesUsed[i] ?? 0);
        totalResults += retry.totalResults;
        if (retry.truncated) truncated = true;
        errors.push(...retry.errors);
        for (const c of retry.corsi) {
          if (!byId.has(String(c.id))) queryRaw += 1;
          byId.set(String(c.id), c);
        }
      }
    }

    queryResults.push({
      classeCode: query.classeCode,
      lingua: query.lingua,
      durata: query.durata,
      sourceDirections: query.sourceDirections ?? [],
      pagesAllocated: maxPages,
      pagesFetched: queryPagesFetched,
      raw: queryRaw,
      passedGate: 0,
      role: query.roles?.join(",") ?? undefined,
    });
  }

  return {
    byId,
    pagesFetched,
    totalResults,
    truncated,
    errors,
    durataFallbackTried,
    pagesUsed,
    queryResults,
  };
}

async function runQueryBatch(
  queries: UniversitalySearchQuery[],
  pageBudget: number
): Promise<{
  byId: Map<string, UniversitalyCorso>;
  pagesFetched: number;
  totalResults: number;
  truncated: boolean;
  errors: string[];
}> {
  const byId = new Map<string, UniversitalyCorso>();
  if (queries.length === 0 || pageBudget <= 0) {
    return {
      byId,
      pagesFetched: 0,
      totalResults: 0,
      truncated: false,
      errors: [],
    };
  }

  const allocations = allocatePagesRoundRobin(queries.length, pageBudget);
  let pagesFetched = 0;
  let totalResults = 0;
  let truncated = false;
  const errors: string[] = [];

  for (let i = 0; i < queries.length; i++) {
    const maxPages = allocations[i] ?? 0;
    if (maxPages <= 0) continue;
    const search = await searchCorsi(queries[i], { maxPages });
    pagesFetched += search.pagesFetched;
    totalResults += search.totalResults;
    if (search.truncated) truncated = true;
    errors.push(...search.errors);
    for (const c of search.corsi) {
      byId.set(String(c.id), c);
    }
  }

  return { byId, pagesFetched, totalResults, truncated, errors };
}

function annotateQueryPassedGate(
  queryResults: NonNullable<LiveSearchMeta["queryResults"]>,
  passed: UniversitalyCorso[]
): NonNullable<LiveSearchMeta["queryResults"]> {
  const byClasse = new Map<string, number>();
  for (const c of passed) {
    const code = (c.classe?.codice ?? "").trim().toUpperCase();
    if (!code) continue;
    byClasse.set(code, (byClasse.get(code) ?? 0) + 1);
  }
  return queryResults.map((q) => ({
    ...q,
    passedGate: byClasse.get((q.classeCode ?? "").trim().toUpperCase()) ?? 0,
  }));
}

/**
 * Hybrid live search: profile → Universitaly MIUR classi → soft-gate → upsert.
 * Synonym fallback runs only when post-gate relevant count is below threshold.
 */
export async function searchUniversitalyForProfile(
  profile: MatchingProfile,
  options?: { forceRefresh?: boolean }
): Promise<LiveSearchMeta> {
  const plan = await mapProfileToUniversitalyQuery(profile);

  if (!options?.forceRefresh) {
    const cached = await findRecentCache(profile.studentId, plan.fingerprint);
    if (cached) {
      const pays = await prisma.programAcademicYear.findMany({
        where: { id: { in: cached.programAcademicYearIds } },
        include: { program: true },
      });
      const gated = pays.filter((pay) => {
        const { relevant } = isCandidateRelevant({
          degreeClass: pay.program.degreeClass,
          name: pay.program.name,
          fieldTags: (() => {
            try {
              return JSON.parse(pay.program.fieldTagsJson || "[]") as string[];
            } catch {
              return [];
            }
          })(),
          selectedClasses: plan.classeCodes,
          selectedDirections: plan.directions,
          miurCodes: plan.miurCodes,
        });
        return relevant;
      });
      const gatedIds = gated.map((p) => p.id);
      const cachedMeta = cached.liveMeta ?? {};

      return {
        source: "universitaly-cache",
        fingerprint: plan.fingerprint,
        pagesFetched: cachedMeta.pagesFetched ?? 0,
        totalResults: gatedIds.length,
        candidateCount: gatedIds.length,
        enrichedCount: 0,
        truncated: false,
        errors: [],
        warning: cachedMeta.warning ?? null,
        programAcademicYearIds: gatedIds,
        directionsSearched: plan.directions,
        directionsSelected: plan.directions,
        miurCodes: plan.miurCodes,
        rawCount: cachedMeta.rawCount,
        afterCityFilterCount: cachedMeta.afterCityFilterCount,
        afterSoftGateCount: cachedMeta.afterSoftGateCount,
        afterSynonymCount: cachedMeta.afterSynonymCount,
        usedSynonymFallback: cachedMeta.usedSynonymFallback,
        coverage: cachedMeta.coverage,
        gateHistogram: cachedMeta.gateHistogram,
        queryResults: cachedMeta.queryResults,
        preGateSample: cachedMeta.preGateSample,
        postGateSample: cachedMeta.postGateSample,
      };
    }
  }

  const pageAllocations = allocatePagesRoundRobin(
    plan.queries.length,
    UNIVERSITALY_MAX_PAGES
  );
  const coverageSplit = splitCoverageByAllocation(
    plan.queries,
    pageAllocations
  );
  const queried = coverageSplit.queried;
  const deferred = coverageSplit.deferred;
  for (let i = 0; i < plan.queries.length; i++) {
    plan.queries[i].pagesAllocated = pageAllocations[i] ?? 0;
  }

  let usedSynonymFallback = false;
  let thinPoolRetry = false;
  let primary = await runAllocatedQueries(
    plan.queries,
    pageAllocations,
    plan.degreeLevel
  );

  const rawList = [...primary.byId.values()];
  const cityFiltered = rawList.filter((c) =>
    corsoMatchesCities(c, plan.preferredCities, plan.excludedCities)
  );
  const gateHistogram = emptyGateHistogram();
  gateHistogram.city_excluded = rawList.length - cityFiltered.length;

  let gateResult = gateCorsi(
    cityFiltered,
    plan.classeCodes,
    plan.directions,
    plan.miurCodes
  );
  let relevant = gateResult.passed;
  gateHistogram.no_classe_no_tag += gateResult.histogram.no_classe_no_tag;
  gateHistogram.passed += gateResult.histogram.passed;

  const relevantBeforeSynonym = relevant.length;
  const preGateSample = cityFiltered.slice(0, SAMPLE_CAP).map(corsoSample);

  const remainingPages = Math.max(
    0,
    UNIVERSITALY_MAX_PAGES - primary.pagesFetched
  );
  if (
    plan.synonymQueries.length > 0 &&
    relevant.length < UNIVERSITALY_SYNONYM_FALLBACK_MIN_CANDIDATES &&
    remainingPages > 0
  ) {
    usedSynonymFallback = true;
    const fallback = await runQueryBatch(plan.synonymQueries, remainingPages);
    for (const [id, corso] of fallback.byId) {
      if (!primary.byId.has(id)) primary.byId.set(id, corso);
    }
    primary = {
      ...primary,
      pagesFetched: primary.pagesFetched + fallback.pagesFetched,
      totalResults: Math.max(primary.totalResults, fallback.totalResults),
      truncated: primary.truncated || fallback.truncated,
      errors: [...primary.errors, ...fallback.errors],
    };
    const mergedCity = [...primary.byId.values()].filter((c) =>
      corsoMatchesCities(c, plan.preferredCities, plan.excludedCities)
    );
    gateResult = gateCorsi(
      mergedCity,
      plan.classeCodes,
      plan.directions,
      plan.miurCodes
    );
    relevant = gateResult.passed;
    gateHistogram.no_classe_no_tag = gateResult.histogram.no_classe_no_tag;
    gateHistogram.passed = gateResult.histogram.passed;
  }

  if (
    relevant.length < MATCH_LIMIT_MIN &&
    primary.pagesFetched < UNIVERSITALY_MAX_PAGES_EXTENDED
  ) {
    const orderedPrimary = orderPrimaryQueriesForThinPoolRetry(
      plan.queries,
      deferred
    );
    const extraBudget = UNIVERSITALY_MAX_PAGES_EXTENDED - primary.pagesFetched;
    if (orderedPrimary.length > 0 && extraBudget > 0) {
      thinPoolRetry = true;
      const extraAlloc = allocatePagesRoundRobin(
        orderedPrimary.length,
        extraBudget
      );
      // Prefer giving first pages to deferred primaries (already ordered first).
      const retry = await runAllocatedQueries(
        orderedPrimary,
        extraAlloc,
        plan.degreeLevel
      );
      for (const [id, corso] of retry.byId) {
        if (!primary.byId.has(id)) primary.byId.set(id, corso);
      }
      // Move previously deferred queries that received pages into queried metadata.
      for (let i = 0; i < orderedPrimary.length; i++) {
        if ((extraAlloc[i] ?? 0) <= 0) continue;
        const q = orderedPrimary[i];
        const key = `${q.classeCode ?? ""}|${q.lingua ?? ""}|${q.durata ?? ""}`;
        const wasDeferred = deferred.findIndex(
          (d) =>
            `${d.classeCode ?? ""}|${d.lingua ?? ""}|${d.durata ?? ""}` === key
        );
        if (wasDeferred >= 0) {
          const [item] = deferred.splice(wasDeferred, 1);
          queried.push({
            ...item,
            pagesAllocated: (item.pagesAllocated ?? 0) + (extraAlloc[i] ?? 0),
            reason: undefined,
          });
        }
      }
      primary = {
        ...primary,
        pagesFetched: primary.pagesFetched + retry.pagesFetched,
        totalResults: Math.max(primary.totalResults, retry.totalResults),
        truncated: primary.truncated || retry.truncated,
        errors: [...primary.errors, ...retry.errors],
        queryResults: [...(primary.queryResults ?? []), ...retry.queryResults],
      };
      const mergedCity = [...primary.byId.values()].filter((c) =>
        corsoMatchesCities(c, plan.preferredCities, plan.excludedCities)
      );
      gateResult = gateCorsi(
        mergedCity,
        plan.classeCodes,
        plan.directions,
        plan.miurCodes
      );
      relevant = gateResult.passed;
      gateHistogram.no_classe_no_tag = gateResult.histogram.no_classe_no_tag;
      gateHistogram.passed = gateResult.histogram.passed;
    }
  }

  const relevantAfterSynonym = relevant.length;
  const queryResults = annotateQueryPassedGate(
    primary.queryResults ?? [],
    relevant
  );

  const upserted = await upsertUniversitalyCandidates(relevant, {
    fallbackAcademicYear: profile.targetAcademicYear,
  });

  const warningParts: string[] = [];
  if (primary.errors.length) {
    warningParts.push(
      `Universitaly API degraded: ${primary.errors[0]}${primary.errors.length > 1 ? ` (+${primary.errors.length - 1})` : ""}`
    );
  }
  if (usedSynonymFallback) {
    warningParts.push(
      `Synonym keyword fallback merged (relevant pool below ${UNIVERSITALY_SYNONYM_FALLBACK_MIN_CANDIDATES}).`
    );
  }
  if (thinPoolRetry) {
    warningParts.push(
      `Thin pool retry: fetched extra pages on primary classe queries (target ${MATCH_LIMIT_MIN}).`
    );
  }
  if (deferred.length > 0) {
    const deferredDirs = [
      ...new Set(deferred.flatMap((d) => d.sourceDirections)),
    ];
    warningParts.push(
      `Page budget deferred ${deferred.length} quer${deferred.length === 1 ? "y" : "ies"}` +
        (deferredDirs.length
          ? ` (directions: ${deferredDirs.join(", ")})`
          : "") +
        "."
    );
  }
  if (upserted.length === 0) {
    warningParts.push("No Universitaly programmes matched these filters.");
  }
  if (primary.truncated) {
    warningParts.push(
      `Results capped across ${queried.length} quer${queried.length === 1 ? "y" : "ies"} (${primary.pagesFetched} pages).`
    );
  }

  return {
    source: "universitaly-live",
    fingerprint: plan.fingerprint,
    pagesFetched: primary.pagesFetched,
    totalResults: primary.totalResults,
    candidateCount: upserted.length,
    enrichedCount: 0,
    truncated: primary.truncated,
    errors: primary.errors,
    warning: warningParts.length ? warningParts.join(" ") : null,
    programAcademicYearIds: upserted.map((u) => u.programAcademicYearId),
    directionsSearched: plan.directions,
    directionsSelected: plan.directions,
    classeQueries: queried,
    coverage: { queried, deferred },
    usedSynonymFallback,
    relevantBeforeSynonym,
    relevantAfterSynonym,
    durataFallbackTried: primary.durataFallbackTried,
    miurCodes: plan.miurCodes,
    rawCount: rawList.length,
    afterCityFilterCount: cityFiltered.length,
    afterSoftGateCount: relevantBeforeSynonym,
    afterSynonymCount: relevantAfterSynonym,
    preGateSample,
    postGateSample: relevant.slice(0, SAMPLE_CAP).map(corsoSample),
    gateHistogram,
    queryResults,
    thinPoolRetry,
  };
}
