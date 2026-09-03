export type BandoUrlCandidate = {
  url: string;
  score: number;
  label: string;
  isPdf: boolean;
  kind: "bando" | "tasse" | "requisiti" | "other";
};

const KEYWORD_RE =
  /bando|ammissione|admission|how-to-enrol|how_to_enrol|iscriversi|call\s+for\s+application|call\s+for\s+applications|requisiti|requirements|avviso|selezione|tasse|tuition|fees|contribuzione|isee|iscrizione|candidatura|allegato/i;

const YEAR_TOKEN_RE = /\b(20\d{2})(?:[\/\-_](20\d{2}))?\b/g;

// University sites use the word "bando" for every public notice.  Grants,
// transport passes and housing notices are not admission calls and used to be
// selected ahead of the real programme information merely because they had a
// year in the URL.  Keep actual tuition pages, but discard clearly unrelated
// welfare notices before ranking.
const NON_ADMISSION_NOTICE_RE =
  /agevolazioni|abbonamenti?|\btper\b|borse?(?:\s+di\s+studio)?|scholarship|benefici|diritto\s+allo\s+studio|contributi|alloggio|accommodation|premi|housing|residenza|mensa|\bdsu\b|welfare|contributo\s+affitto/i;
const ADMISSION_PURPOSE_RE =
  /ammissione|admission|application|candidatura|immatricol|enrol(?:ment)?|iscrizione|requisiti|requirements|tasse|tuition|fees|contribuzione|isee/i;
/** Study plans / timetables are not admission or fee documents (e.g. PIANO DI STUDI PDFs). */
const STUDY_PLAN_OR_TIMETABLE_RE =
  /piano[\s_%+-]*di[\s_%+-]*studi|piano[_-]di[_-]studi|manifesto[\s_%+-]*degli[\s_%+-]*studi|orario(?:[\s_%+-]+delle?[\s_%+-]+lezioni)?|calendario[\s_%+-]*didattico|syllabus|guida[\s_%+-]*dello[\s_%+-]*studente|insegnamenti|study[\s_%+-_-]?plan/i;

/** Quality-policy / AQ PDFs are not admission calls (e.g. Visione della qualità). */
const QUALITY_POLICY_DOC_RE =
  /visione[\s_%+-]*della[\s_%+-]*qualit|politiche[\s_%+-]*per[\s_%+-]*la[\s_%+-]*qualit|assurance[\s_%+-]*qualit|sistema[\s_%+-]*qualit|ava[\s_%+-]*anvur|suo?\s*rapporto[\s_%+-]*di[\s_%+-]*riesame/i;

export function isStudyPlanOrTimetable(hay: string): boolean {
  try {
    const decoded = decodeURIComponent(hay.replace(/\+/g, " "));
    return STUDY_PLAN_OR_TIMETABLE_RE.test(decoded);
  } catch {
    return STUDY_PLAN_OR_TIMETABLE_RE.test(hay);
  }
}

export function isQualityPolicyDocument(hay: string): boolean {
  try {
    const decoded = decodeURIComponent(hay.replace(/\+/g, " "));
    return QUALITY_POLICY_DOC_RE.test(decoded);
  } catch {
    return QUALITY_POLICY_DOC_RE.test(hay);
  }
}

function yearTokensFromAcademicYear(academicYear?: string): string[] {
  if (!academicYear) return [];
  const parts = academicYear.match(/20\d{2}/g) || [];
  const out = [...parts];
  if (parts.length >= 2) {
    out.push(`${parts[0]}/${parts[1]}`, `${parts[0]}-${parts[1]}`);
  }
  return out;
}

function resolveUrl(href: string, baseUrl: string): string | null {
  try {
    const u = new URL(href, baseUrl);
    if (!/^https?:$/i.test(u.protocol)) return null;
    return u.toString();
  } catch {
    return null;
  }
}

function classifyKind(hay: string): BandoUrlCandidate["kind"] {
  if (isStudyPlanOrTimetable(hay)) return "other";
  if (/tasse|tuition|fees|contribuzione|isee/i.test(hay)) return "tasse";
  if (
    /requisiti|requirements|how-to-enrol|how_to_enrol|iscriversi|ammissione\/?$/i.test(
      hay
    )
  ) {
    return "requisiti";
  }
  if (
    /bando|ammissione|admission|call\s+for\s+application|how-to-enrol|iscriversi/i.test(
      hay
    )
  ) {
    return "bando";
  }
  return "other";
}

export function isClearlyNonAdmissionNotice(hay: string): boolean {
  return NON_ADMISSION_NOTICE_RE.test(hay) && !ADMISSION_PURPOSE_RE.test(hay);
}

/** Skip during deep-enrich URL fetch (quality policy + welfare notices). */
export function isRejectedEnrichmentCandidateUrl(url: string): boolean {
  return isQualityPolicyDocument(url) || isClearlyNonAdmissionNotice(url);
}

function scoreCandidate(
  url: string,
  anchorText: string,
  academicYear?: string,
  pageUrl?: string
): number {
  const hay = `${url} ${anchorText}`.toLowerCase();
  let score = 0;
  if (isStudyPlanOrTimetable(hay)) return -100;
  if (isQualityPolicyDocument(hay)) return -100;
  const isPdf = /\.pdf(\?|#|$)/i.test(url);
  if (isPdf) score += 40;
  if (/bando/i.test(hay)) score += 35;
  if (/ammissione|admission/i.test(hay)) score += 25;
  if (/how-to-enrol|how_to_enrol|iscriversi/i.test(hay)) score += 45;
  if (/call\s+for\s+application/i.test(hay)) score += 25;
  if (/requisiti|requirements/i.test(hay)) score += 25;
  if (/tasse|tuition|fees|contribuzione|isee/i.test(hay)) score += 30;
  if (/iscrizione|candidatura|allegato/i.test(hay)) score += 12;
  if (/avviso|selezione/i.test(hay)) score += 10;
  // Unibo programme sites: enrolment pages beat generic brochure PDFs.
  if (/corsi\.unibo\.it/i.test(url) && /how-to-enrol|admission|iscriversi|ammissione/i.test(hay)) {
    score += 35;
  }

  if (pageUrl) {
    try {
      const pagePath = new URL(pageUrl).pathname;
      const urlPath = new URL(url).pathname;
      const pageSegments = pagePath.split("/").filter(Boolean);
      const shared = pageSegments.filter((seg) => urlPath.includes(seg));
      if (shared.length >= 2) score += 25;
      if (/cineca\.it\/corsi\/|timeview\/20\d{2}\//i.test(url)) score += 15;
    } catch {
      /* ignore */
    }
  }

  const yearTokens = yearTokensFromAcademicYear(academicYear);
  for (const t of yearTokens) {
    if (hay.includes(t.toLowerCase())) score += 30;
  }

  if (!academicYear) {
    const years = hay.match(YEAR_TOKEN_RE);
    if (years?.length) score += 5;
  }

  return score;
}

/** Same host or same registrable domain (last two labels). */
export function sameRegistrableDomain(a: string, b: string): boolean {
  try {
    const ha = new URL(a).hostname.toLowerCase();
    const hb = new URL(b).hostname.toLowerCase();
    if (ha === hb) return true;
    const ra = ha.split(".").slice(-2).join(".");
    const rb = hb.split(".").slice(-2).join(".");
    return ra === rb && ra.includes(".");
  } catch {
    return false;
  }
}

/**
 * Discover admission-call / bando / tasse / requisiti URLs from a programme HTML page.
 */
export function discoverBandoUrls(
  html: string,
  pageUrl: string,
  options?: { academicYear?: string; limit?: number; includeTuition?: boolean }
): BandoUrlCandidate[] {
  const limit = options?.limit ?? 5;
  const academicYear = options?.academicYear;
  const byUrl = new Map<string, BandoUrlCandidate>();

  const anchorRe =
    /<a\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let m: RegExpExecArray | null;
  while ((m = anchorRe.exec(html)) !== null) {
    const href = m[1].trim();
    const label = m[2].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    const resolved = resolveUrl(href, pageUrl);
    if (!resolved) continue;
    if (!sameRegistrableDomain(resolved, pageUrl) && resolved !== pageUrl) {
      // Allow only same domain for safety
      continue;
    }

    const isPdf = /\.pdf(\?|#|$)/i.test(resolved);
    const hay = `${href} ${label}`;
    const keywordHit = KEYWORD_RE.test(href) || KEYWORD_RE.test(label);
    if (!isPdf && !keywordHit) continue;
    if (isClearlyNonAdmissionNotice(hay)) continue;
    if (isStudyPlanOrTimetable(hay) || isStudyPlanOrTimetable(resolved)) continue;
    if (isQualityPolicyDocument(hay) || isQualityPolicyDocument(resolved)) continue;

    const score = scoreCandidate(resolved, label, academicYear, pageUrl);
    if (score < 15) continue;

    const existing = byUrl.get(resolved);
    if (!existing || existing.score < score) {
      byUrl.set(resolved, {
        url: resolved,
        score,
        label: label.slice(0, 120) || resolved,
        isPdf,
        kind: classifyKind(`${resolved} ${label}`),
      });
    }
  }

  const hrefRe = /href\s*=\s*["']([^"']+\.pdf[^"']*)["']/gi;
  while ((m = hrefRe.exec(html)) !== null) {
    const resolved = resolveUrl(m[1].trim(), pageUrl);
    if (!resolved) continue;
    if (!sameRegistrableDomain(resolved, pageUrl)) continue;
    if (isClearlyNonAdmissionNotice(resolved)) continue;
    if (isStudyPlanOrTimetable(resolved)) continue;
    if (isQualityPolicyDocument(resolved)) continue;
    const score = scoreCandidate(resolved, "", academicYear, pageUrl);
    const existing = byUrl.get(resolved);
    if (!existing || existing.score < score) {
      byUrl.set(resolved, {
        url: resolved,
        score: Math.max(score, 20),
        label: resolved,
        isPdf: true,
        kind: classifyKind(resolved),
      });
    }
  }

  return [...byUrl.values()]
    .filter((candidate) => options?.includeTuition !== false || candidate.kind !== "tasse")
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

/**
 * Programme roots often omit enrolment content; synthesize common admission paths.
 * Covers Unibo corsi.*, Ca' Foscari-style /iscriversi, and generic EN/IT leaves.
 */
export function admissionSiblingUrls(
  pageUrl: string,
  options?: { includeTuition?: boolean }
): BandoUrlCandidate[] {
  try {
    const u = new URL(pageUrl);
    const host = u.hostname.toLowerCase();
    let base = u.pathname.replace(/\/$/, "");
    base = base.replace(
      /\/(how-to-enrol|admission|iscriversi|ammissione|immatricolazione|ammissione-e-immatricolazione|index\.html?)$/i,
      ""
    );
    if (!base || base === "/") return [];

    const out: BandoUrlCandidate[] = [];
    const suffixes: string[] = [];
    if (/corsi\.unibo\.it$/i.test(host)) {
      suffixes.push("/how-to-enrol", "/admission");
      // Central ateneo fees (university-wide), same registrable domain.
      if (options?.includeTuition !== false) {
        out.push({
          url: `${u.protocol}//www.unibo.it/en/teaching/enrolment-transfer-and-final-examination/tuition-fees-and-exemptions/tuition-fees`,
          score: 75,
          label: "unibo-tuition-fees",
          isPdf: false,
          kind: "tasse",
        });
        out.push({
          url: `${u.protocol}//www.unibo.it/it/didattica/iscrizioni-trasferimenti-e-laurea/tasse-e-contributi/tasse-universitarie`,
          score: 75,
          label: "unibo-tasse",
          isPdf: false,
          kind: "tasse",
        });
      }
    } else if (/unive\.it$/i.test(host)) {
      suffixes.push("/iscriversi", "/ammissione-e-immatricolazione");
    } else if (/unito\.it$/i.test(host) && /View\?doc=/i.test(pageUrl)) {
      // Unito CMS: swap tuition doc for requirements / fees siblings when possible.
      const altDocs = [
        "admission_requirements.html",
        "admission_requirements.htm",
        "requirements.html",
        "how_to_apply.html",
        "tuition_fees_and_financial_aid.html",
      ];
      for (const doc of altDocs) {
        const url = pageUrl.replace(/View\?doc=[^&]+/i, `View?doc=${doc}`);
        if (url === pageUrl) continue;
        out.push({
          url,
          score: 70,
          label: doc,
          isPdf: false,
          kind: /tuition|fees|financial/i.test(doc) ? "tasse" : "requisiti",
        });
      }
      return out;
    } else {
      suffixes.push("/how-to-enrol", "/admission", "/iscriversi");
    }

    for (const suf of suffixes) {
      const url = `${u.protocol}//${u.host}${base}${suf}`;
      if (url.replace(/\/$/, "") === pageUrl.replace(/\/$/, "")) continue;
      out.push({
        url,
        score: 80,
        label: suf.slice(1),
        isPdf: false,
        kind: "bando",
      });
    }
    return out;
  } catch {
    return [];
  }
}

/** @deprecated use admissionSiblingUrls */
export function uniboAdmissionSiblingUrls(pageUrl: string): BandoUrlCandidate[] {
  return admissionSiblingUrls(pageUrl).filter((c) =>
    /corsi\.unibo\.it/i.test(c.url)
  );
}

/** Prefer up to `limit` tasse/requisiti/bando follow links (depth-1).
 * Always try to include at least one tasse, one requisiti, and one bando when present.
 */
export function pickFollowLinks(
  candidates: BandoUrlCandidate[],
  limit = 3,
  pageUrl?: string,
  options?: { includeTuition?: boolean }
): BandoUrlCandidate[] {
  const follow = candidates.filter(
    (c) =>
      (options?.includeTuition !== false && c.kind === "tasse") ||
      c.kind === "requisiti" ||
      c.kind === "bando"
  );
  const rank = (list: BandoUrlCandidate[]) => {
    if (!pageUrl) return list;
    try {
      const pagePath = new URL(pageUrl).pathname;
      const pageSegments = pagePath.split("/").filter(Boolean);
      return [...list].sort((a, b) => {
        const aShared = pageSegments.filter((seg) => a.url.includes(seg)).length;
        const bShared = pageSegments.filter((seg) => b.url.includes(seg)).length;
        if (aShared !== bShared) return bShared - aShared;
        return b.score - a.score;
      });
    } catch {
      return list;
    }
  };
  const tasse = rank(follow.filter((c) => c.kind === "tasse"));
  const requisiti = rank(follow.filter((c) => c.kind === "requisiti"));
  const bando = rank(follow.filter((c) => c.kind === "bando"));
  const picked: BandoUrlCandidate[] = [];
  if (tasse[0]) picked.push(tasse[0]);
  if (requisiti[0] && picked.length < limit) picked.push(requisiti[0]);
  if (bando[0] && picked.length < limit) picked.push(bando[0]);
  for (const c of rank(follow)) {
    if (picked.length >= limit) break;
    if (!picked.some((p) => p.url === c.url)) picked.push(c);
  }
  return picked;
}
