import { extractFromHtml } from "@/server/services/program-enrichment/html-extract";
import {
  planProgrammePageDiscovery,
  programmeNameMatchScore,
} from "./programme-page-discovery";

export type ProgrammeSourceFetchResult = {
  ok: boolean;
  body: string;
  contentType: string;
};

export type ResolvedProgrammeSource = {
  status: "RESOLVED";
  url: string;
  body: string;
  contentType: string;
  method:
    | "DIRECT"
    | "LANDING_LINK"
    | "CATALOGUE_LINK"
    | "SITEMAP"
    | "WEB_SEARCH";
  attemptedUrls: string[];
};

export type ProgrammeSourceResolution =
  | ResolvedProgrammeSource
  | {
      status: "NOT_FOUND";
      url: null;
      body: null;
      contentType: null;
      method: null;
      attemptedUrls: string[];
    };

function isHtml(result: ProgrammeSourceFetchResult): boolean {
  return (
    /html/i.test(result.contentType) ||
    /<!doctype html|<html/i.test(result.body.slice(0, 500))
  );
}

function isXml(result: ProgrammeSourceFetchResult): boolean {
  return (
    /xml/i.test(result.contentType) ||
    /<(?:urlset|sitemapindex)\b/i.test(result.body.slice(0, 2_000))
  );
}

function xmlLocations(xml: string): string[] {
  const urls: string[] = [];
  const re = /<loc\b[^>]*>\s*([^<\s]+)\s*<\/loc>/gi;
  let match: RegExpExecArray | null;
  while ((match = re.exec(xml)) !== null) {
    urls.push(match[1].replace(/&amp;/gi, "&"));
  }
  return [...new Set(urls)];
}

function rootDomain(hostname: string): string | null {
  const parts = hostname.toLowerCase().split(".").filter(Boolean);
  return parts.length >= 2 ? parts.slice(-2).join(".") : null;
}

/** The same university often exposes programmes on www while Universitaly links a school subdomain. */
function sitemapRoots(officialUrl: string): string[] {
  const root = new URL(officialUrl);
  const domain = rootDomain(root.hostname);
  const hosts = new Set([root.hostname]);
  if (domain) {
    hosts.add(domain);
    hosts.add(`www.${domain}`);
  }
  return [...hosts].flatMap((host) => [
    `https://${host}/robots.txt`,
    `https://${host}/sitemap.xml`,
    `https://${host}/sitemap_index.xml`,
  ]);
}

function sitemapHintsFromRobots(body: string): string[] {
  return body
    .split(/\r?\n/)
    .map((line) => line.match(/^\s*sitemap:\s*(\S+)/i)?.[1] ?? null)
    .filter((url): url is string => !!url);
}

function uniqueNames(names: Array<string | null | undefined>): string[] {
  return [...new Set(names.map((name) => name?.trim()).filter((name): name is string => !!name))];
}

/**
 * Resolves the *programme source*, not an admission fact. The resolver is
 * deliberately deterministic and bounded: direct page → catalogue → sitemap
 * across the university's official web properties. Search-engine snippets and
 * generic university pages are never evidence.
 */
export async function resolveProgrammeSource(input: {
  officialUrl: string;
  programmeNames: Array<string | null | undefined>;
  initial: ProgrammeSourceFetchResult;
  fetchUrl: (url: string) => Promise<ProgrammeSourceFetchResult>;
  maxFetches?: number;
}): Promise<ProgrammeSourceResolution> {
  const names = uniqueNames(input.programmeNames);
  const attemptedUrls = [input.officialUrl];
  const maxFetches = input.maxFetches ?? 16;
  let fetches = 0;

  const fetchHtml = async (url: string) => {
    if (fetches >= maxFetches) return null;
    fetches += 1;
    attemptedUrls.push(url);
    const result = await input.fetchUrl(url);
    return result.ok && isHtml(result) ? result : null;
  };
  const resolved = (
    url: string,
    page: ProgrammeSourceFetchResult,
    method: NonNullable<ProgrammeSourceResolution["method"]>
  ): ResolvedProgrammeSource => ({
    status: "RESOLVED",
    url,
    body: page.body,
    contentType: page.contentType,
    method,
    attemptedUrls,
  });

  if (!input.initial.ok || !isHtml(input.initial) || names.length === 0) {
    return { status: "NOT_FOUND", url: null, body: null, contentType: null, method: null, attemptedUrls };
  }

  const rootPage = extractFromHtml(input.initial.body, input.officialUrl);
  let plan = planProgrammePageDiscovery({
    pageUrl: input.officialUrl,
    pageTitle: rootPage.title,
    links: rootPage.links,
    programmeNames: names,
  });
  if (plan.kind === "already_programme_page") {
    return resolved(input.officialUrl, input.initial, "DIRECT");
  }
  if (plan.kind === "direct_link") {
    const page = await fetchHtml(plan.link.url);
    if (page) return resolved(plan.link.url, page, "LANDING_LINK");
  }
  if (plan.kind === "catalogue_link") {
    for (const catalogue of plan.links) {
      const cataloguePage = await fetchHtml(catalogue.url);
      if (!cataloguePage) continue;
      const extracted = extractFromHtml(cataloguePage.body, catalogue.url);
      plan = planProgrammePageDiscovery({
        pageUrl: catalogue.url,
        pageTitle: extracted.title,
        links: extracted.links,
        programmeNames: names,
      });
      if (plan.kind === "already_programme_page") {
        return resolved(catalogue.url, cataloguePage, "CATALOGUE_LINK");
      }
      if (plan.kind !== "direct_link") continue;
      const programmePage = await fetchHtml(plan.link.url);
      if (programmePage) return resolved(plan.link.url, programmePage, "CATALOGUE_LINK");
    }
  }

  // SPA landing pages frequently contain no usable anchors at all. A sitemap
  // is an official site index, so it gives the resolver a universal fallback
  // without trusting a third-party search result.
  const sitemapUrls = new Set<string>();
  for (const root of sitemapRoots(input.officialUrl)) {
    if (fetches >= maxFetches) break;
    fetches += 1;
    attemptedUrls.push(root);
    const fetched = await input.fetchUrl(root);
    if (/robots\.txt(?:$|[?#])/i.test(root)) {
      for (const hint of sitemapHintsFromRobots(fetched.body)) sitemapUrls.add(hint);
    } else if (fetched.ok && isXml(fetched)) {
      sitemapUrls.add(root);
    }
  }

  const candidateUrls = new Set<string>();
  for (const sitemapUrl of sitemapUrls) {
    if (fetches >= maxFetches) break;
    fetches += 1;
    attemptedUrls.push(sitemapUrl);
    const sitemap = await input.fetchUrl(sitemapUrl);
    if (!sitemap.ok || !isXml(sitemap)) continue;
    const locations = xmlLocations(sitemap.body);
    const direct = locations.filter(
      (url) => programmeNameMatchScore(url, names) >= 75
    );
    // Resolve a named URL immediately. Deferring it until every sitemap index
    // has been expanded exhausts the bounded crawl budget on large sites.
    for (const url of direct.slice(0, 2)) {
      const page = await fetchHtml(url);
      if (page) return resolved(url, page, "SITEMAP");
    }
    for (const url of direct) candidateUrls.add(url);
    // Sitemap indexes contain other sitemap files rather than page URLs.
    if (direct.length === 0) {
      for (const child of locations.filter((url) => /sitemap.*\.xml/i.test(url)).slice(0, 2)) {
        if (fetches >= maxFetches) break;
        fetches += 1;
        attemptedUrls.push(child);
        const nested = await input.fetchUrl(child);
        if (!nested.ok || !isXml(nested)) continue;
        for (const url of xmlLocations(nested.body)) {
          if (programmeNameMatchScore(url, names) >= 75) candidateUrls.add(url);
        }
      }
    }
  }

  for (const url of [...candidateUrls].slice(0, 2)) {
    const page = await fetchHtml(url);
    if (page) return resolved(url, page, "SITEMAP");
  }

  return { status: "NOT_FOUND", url: null, body: null, contentType: null, method: null, attemptedUrls };
}
