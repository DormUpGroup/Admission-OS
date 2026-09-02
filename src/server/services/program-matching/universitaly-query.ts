import { createHash } from "crypto";
import {
  UNIVERSITALY_MAX_QUERY_SLICES,
} from "@/lib/program-matching/config";
import { durataForClasse, isKnownSingleCycleClasse } from "@/lib/program-matching/miur-durata";
import {
  buildMiurProvenance,
  type MiurCodeProvenance,
} from "@/lib/program-matching/miur-provenance";
import type { MatchingProfile } from "@/lib/program-matching/types";
import type { UniversitalySearchQuery } from "@/server/services/program-ingestion/universitaly-client";
import {
  synonymsForInterests,
  type ClasseRole,
} from "@/lib/program-matching/taxonomy";
import { resolveClasseId } from "@/server/services/program-matching/miur-classi";

export type { MiurCodeProvenance };

export type PlannedUniversitalyQuery = UniversitalySearchQuery & {
  classeCode?: string;
  sourceDirections: string[];
  roles: ClasseRole[];
  /** Pages allocated by round-robin budget (set in live-search). */
  pagesAllocated?: number;
  /** Unknown SINGLE_CYCLE: tried durata 6 after empty 5. */
  durataFallbackTried?: boolean;
};

export type CoverageEntry = {
  classeCode?: string;
  lingua?: string;
  durata?: string;
  sourceDirections: string[];
  reason?: string;
};

export type UniversitalyQueryPlan = {
  /** Primary MIUR classe × lingua × durata queries (deduped). */
  queries: PlannedUniversitalyQuery[];
  /**
   * Synonym searchText × lingua — merged when post-gate relevant count is below
   * UNIVERSITALY_SYNONYM_FALLBACK_MIN_CANDIDATES (see live-search).
   */
  synonymQueries: UniversitalySearchQuery[];
  /** Primary / first query (compat). */
  query: UniversitalySearchQuery;
  fingerprint: string;
  preferredCities: string[];
  excludedCities: string[];
  /** All selected questionnaire / interest labels preserved in provenance. */
  directions: string[];
  /**
   * Selected MIUR codes (normalized) for soft-gate / fit — full selected set,
   * including codes that failed Universitaly resolve (those simply have no query).
   */
  classeCodes: string[];
  /** Per-code primary/secondary provenance across directions. */
  miurCodes: MiurCodeProvenance[];
  /** Degree level used for durata. */
  degreeLevel: string;
};

/** One or both teaching languages as Universitaly `lingua` filters. */
export function linguasFromProfile(
  profile: MatchingProfile
): Array<"EN" | "IT"> {
  const langs = profile.preferredTeachingLanguages.map((l) => l.toLowerCase());
  const wantsEn = langs.some((l) => l.includes("english") || l === "en");
  const wantsIt = langs.some((l) => l.includes("italian") || l === "it");
  if (wantsEn && wantsIt) return ["EN", "IT"];
  if (wantsEn) return ["EN"];
  if (wantsIt) return ["IT"];
  return ["EN"];
}

export function fingerprintUniversitalyQuery(
  query: UniversitalySearchQuery,
  excludedCities: string[]
): string {
  const payload = JSON.stringify({
    lingua: query.lingua ?? "",
    durata: query.durata ?? "",
    area: query.area ?? "",
    tipoClasse: query.tipoClasse ?? "",
    searchText: query.searchText ?? "",
    // Preferred cities are secondary (fit only); fingerprint exclude-list only.
    excluded: [...excludedCities].map((c) => c.toLowerCase()).sort(),
  });
  return createHash("sha256").update(payload).digest("hex").slice(0, 24);
}

function fingerprintMultiQuery(
  queries: UniversitalySearchQuery[],
  excludedCities: string[]
): string {
  const parts = queries
    .map((q) => fingerprintUniversitalyQuery(q, excludedCities))
    .sort();
  return createHash("sha256").update(parts.join("|")).digest("hex").slice(0, 24);
}

/**
 * Round-robin page allocation across unique queries.
 * Queries with 0 pages are deferred (caller records coverage.deferred).
 */
export function allocatePagesRoundRobin(
  queryCount: number,
  pageBudget: number
): number[] {
  const pages = Array.from({ length: queryCount }, () => 0);
  if (queryCount === 0 || pageBudget <= 0) return pages;
  let remaining = pageBudget;
  let i = 0;
  while (remaining > 0) {
    pages[i % queryCount] += 1;
    remaining -= 1;
    i += 1;
  }
  return pages;
}

export type CoverageSplitItem = {
  classeCode?: string;
  lingua?: string;
  durata?: string;
  sourceDirections: string[];
  pagesAllocated: number;
  reason?: string;
};

export function splitCoverageByAllocation<
  T extends {
    classeCode?: string;
    lingua?: string;
    durata?: string;
    sourceDirections: string[];
  },
>(
  queries: T[],
  allocations: number[]
): { queried: CoverageSplitItem[]; deferred: CoverageSplitItem[] } {
  const queried: CoverageSplitItem[] = [];
  const deferred: CoverageSplitItem[] = [];
  for (let i = 0; i < queries.length; i++) {
    const q = queries[i];
    const pages = allocations[i] ?? 0;
    const item: CoverageSplitItem = {
      classeCode: q.classeCode,
      lingua: q.lingua,
      durata: q.durata,
      sourceDirections: q.sourceDirections,
      pagesAllocated: pages,
    };
    if (pages > 0) queried.push(item);
    else deferred.push({ ...item, reason: "page_budget_exhausted" });
  }
  return { queried, deferred };
}

function queryKey(q: {
  classeCode?: string;
  lingua?: string;
  durata?: string;
}): string {
  return `${q.classeCode ?? ""}|${q.lingua ?? ""}|${q.durata ?? ""}`;
}

/**
 * Thin-pool retry order: deferred primary MIUR queries first, then other primaries.
 * Does not change the overall page budget — only the allocation preference.
 */
export function orderPrimaryQueriesForThinPoolRetry<
  T extends {
    classeCode?: string;
    lingua?: string;
    durata?: string;
    roles: string[];
    sourceDirections: string[];
  },
>(
  queries: T[],
  deferred: CoverageSplitItem[]
): T[] {
  const deferredKeys = new Set(
    deferred.map((d) => queryKey(d))
  );
  const primary = queries.filter((q) => q.roles.includes("primary"));
  const deferredPrimary = primary.filter((q) => deferredKeys.has(queryKey(q)));
  const otherPrimary = primary.filter((q) => !deferredKeys.has(queryKey(q)));
  return [...deferredPrimary, ...otherPrimary];
}

/** Unknown SINGLE_CYCLE: empty durata=5 result may retry durata=6. */
export function shouldRetrySingleCycleDurata6(input: {
  classeCode?: string | null;
  degreeLevel: string;
  durata?: string | null;
  emptyResults: boolean;
}): boolean {
  const code = input.classeCode;
  if (!code || !input.emptyResults || input.durata !== "5") return false;
  if (isKnownSingleCycleClasse(code)) return false;
  return (
    input.degreeLevel === "SINGLE_CYCLE" ||
    durataForClasse(code, input.degreeLevel) === "5"
  );
}

type QueryBucket = {
  query: PlannedUniversitalyQuery;
  directions: Set<string>;
  roles: Set<ClasseRole>;
};

/**
 * Map MatchingProfile → Universitaly search plan.
 * Primary: lingua + per-classe durata + MIUR classe (all selected directions).
 * Synonym queries are prepared for live-search fallback after soft-gate.
 */
export async function mapProfileToUniversitalyQuery(
  profile: MatchingProfile
): Promise<UniversitalyQueryPlan> {
  const linguas = linguasFromProfile(profile);
  const provenance = buildMiurProvenance(profile);

  const buckets = new Map<string, QueryBucket>();

  for (const entry of provenance.miurCodes) {
    const id = await resolveClasseId(entry.code);
    if (id == null) continue;

    const durata = durataForClasse(entry.code, profile.desiredDegreeLevel);
    for (const lingua of linguas) {
      const key = `${entry.code}|${lingua}|${durata}`;
      let bucket = buckets.get(key);
      if (!bucket) {
        bucket = {
          query: {
            lingua,
            durata,
            tipoClasse: id,
            order: "ASC",
            searchType: "u",
            classeCode: entry.code,
            sourceDirections: [],
            roles: [],
          },
          directions: new Set(),
          roles: new Set(),
        };
        buckets.set(key, bucket);
      }
      for (const d of entry.directions) bucket.directions.add(d);
      bucket.roles.add(entry.role);
    }
  }

  const queries: PlannedUniversitalyQuery[] = [...buckets.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([, bucket]) => ({
      ...bucket.query,
      sourceDirections: [...bucket.directions].sort(),
      roles: [...bucket.roles].sort() as ClasseRole[],
    }));

  const synonymKeywords = synonymsForInterests(profile.fieldsOfInterest).slice(
    0,
    UNIVERSITALY_MAX_QUERY_SLICES
  );
  const durataFallback = durataForClasse(null, profile.desiredDegreeLevel);
  const synonymQueries: UniversitalySearchQuery[] = [];
  for (const searchText of synonymKeywords) {
    for (const lingua of linguas) {
      synonymQueries.push({
        lingua,
        durata: durataFallback,
        searchText,
        order: "ASC",
        searchType: "u",
      });
    }
  }

  // Fingerprint MIUR plan only; synonym fallback must not poison 24h cache key
  // when primary later starts returning results.
  const fingerprintQueries: UniversitalySearchQuery[] =
    queries.length > 0
      ? queries
      : synonymQueries.length > 0
        ? synonymQueries
        : linguas.map((lingua) => ({
            lingua,
            durata: durataFallback,
            order: "ASC" as const,
            searchType: "u" as const,
          }));

  const directions =
    provenance.directions.length > 0
      ? provenance.directions
      : [...profile.fieldsOfInterest];

  return {
    queries,
    synonymQueries,
    query: fingerprintQueries[0],
    fingerprint: fingerprintMultiQuery(
      fingerprintQueries,
      profile.excludedCities
    ),
    preferredCities: profile.preferredCities,
    excludedCities: profile.excludedCities,
    directions,
    classeCodes: provenance.classeCodes,
    miurCodes: provenance.miurCodes,
    degreeLevel: profile.desiredDegreeLevel,
  };
}

/**
 * Discovery city filter: drop avoid-list only.
 * Preferred cities are secondary (fit ranking), not a Universitaly gate.
 */
export function corsoMatchesCities(
  corso: {
    nomeStruttura?: string | null;
    sede?: { comuneDescrizione?: string } | null;
  },
  _preferredCities: string[],
  excludedCities: string[]
): boolean {
  if (excludedCities.length === 0) return true;
  const hay = `${corso.nomeStruttura ?? ""} ${corso.sede?.comuneDescrizione ?? ""}`.toLowerCase();
  return !excludedCities.some((c) => hay.includes(c.toLowerCase()));
}
