import type { ClassifiedLink } from "@/server/services/program-enrichment/html-extract";

type LinkLike = Pick<
  ClassifiedLink,
  "linkId" | "label" | "url" | "classification"
>;

export type ProgrammePagePlan =
  | { kind: "already_programme_page" }
  | { kind: "direct_link"; link: LinkLike }
  | { kind: "catalogue_link"; links: LinkLike[] }
  | { kind: "not_found" };

const GENERIC_WORDS = new Set([
  "and",
  "corso",
  "course",
  "degree",
  "di",
  "in",
  "la",
  "laurea",
  "master",
  "of",
  "programme",
  "program",
  "studies",
  "the",
]);

function normalize(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function meaningfulTokens(value: string): string[] {
  return normalize(value)
    .split(" ")
    .filter((word) => word.length >= 3 && !GENERIC_WORDS.has(word));
}

function titleMatchScore(haystack: string, programmeNames: string[]): number {
  const hay = normalize(haystack);
  if (!hay) return 0;

  let best = 0;
  for (const rawName of programmeNames) {
    const name = normalize(rawName);
    if (!name || name.length < 5) continue;
    const tokens = meaningfulTokens(rawName);
    // A bad upstream record occasionally uses a placeholder such as
    // "Programme". It must never make a generic university page look exact.
    if (tokens.length === 0) continue;
    if (hay.includes(name)) {
      best = Math.max(best, 100);
      continue;
    }

    if (tokens.length < 2) continue;
    const matched = tokens.filter((token) => hay.includes(token)).length;
    // Requiring every meaningful word prevents a catalogue's generic
    // "Computer science programmes" navigation item from masquerading as the
    // programme page for "Computer Science and Engineering".
    if (matched === tokens.length) best = Math.max(best, 75);
  }
  return best;
}

function sameSite(url: string, pageUrl: string): boolean {
  try {
    return new URL(url).hostname === new URL(pageUrl).hostname;
  } catch {
    return false;
  }
}

function isCatalogueLink(link: LinkLike): boolean {
  const hay = `${link.label} ${link.url}`.toLowerCase();
  return (
    link.classification === "programme" ||
    /\b(?:programmes?|courses?|corsi|offerta[-_ ]formativa|degree[-_ ]programmes?)\b/i.test(
      hay
    )
  );
}

/**
 * Plans a small, same-site traversal from a university landing page to the
 * named programme. It deliberately does not accept a fuzzy one-word match:
 * using a wrong programme page is worse than leaving a card for review.
 */
export function planProgrammePageDiscovery(input: {
  pageUrl: string;
  pageTitle: string | null;
  links: LinkLike[];
  programmeNames: Array<string | null | undefined>;
}): ProgrammePagePlan {
  const names = input.programmeNames.filter(
    (name): name is string => Boolean(name?.trim())
  );
  if (names.length === 0) return { kind: "not_found" };

  if (titleMatchScore(input.pageTitle ?? "", names) >= 75) {
    return { kind: "already_programme_page" };
  }

  const sameSiteLinks = input.links.filter((link) =>
    sameSite(link.url, input.pageUrl)
  );
  const direct = sameSiteLinks
    .map((link) => ({
      link,
      score: titleMatchScore(`${link.label} ${link.url}`, names),
    }))
    .filter((candidate) => candidate.score >= 75)
    .sort((a, b) => b.score - a.score || a.link.url.localeCompare(b.link.url))[0];
  if (direct) return { kind: "direct_link", link: direct.link };

  const catalogues = sameSiteLinks
    .filter(isCatalogueLink)
    .filter((link) => !/\.pdf(?:[?#]|$)/i.test(link.url))
    .slice(0, 2);
  return catalogues.length
    ? { kind: "catalogue_link", links: catalogues }
    : { kind: "not_found" };
}
