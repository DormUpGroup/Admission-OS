export type ClassifiedLink = {
  linkId: string;
  label: string;
  url: string;
  classification:
    | "programme"
    | "enrol"
    | "bando"
    | "requirements"
    | "tuition"
    | "pdf"
    | "other";
};

export type PageSection = {
  sectionId: string;
  label: string;
  kind: "tab" | "accordion" | "heading" | "other";
  text: string;
};

export type ExtractedPage = {
  title: string | null;
  cleanText: string;
  links: ClassifiedLink[];
  sections: PageSection[];
};

function stripTags(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/\s+/g, " ")
    .trim();
}

function classifyLink(label: string, href: string): ClassifiedLink["classification"] {
  const hay = `${label} ${href}`.toLowerCase();
  if (/\.pdf(\?|#|$)/i.test(href) || hay.includes("pdf")) return "pdf";
  if (
    /bando|call.?for.?application|avviso|admission.?call/i.test(hay)
  ) {
    return "bando";
  }
  if (
    /enrol|enroll|ammission|admission|how.?to.?enrol|iscriv/i.test(hay)
  ) {
    return "enrol";
  }
  if (/requisiti|requirement|qualification.?required/i.test(hay)) {
    return "requirements";
  }
  if (/tasse|tuition|fees|contribuzione|amounts/i.test(hay)) {
    return "tuition";
  }
  if (/programme|program|corso|course/i.test(hay)) return "programme";
  return "other";
}

const PRIORITY_SECTION_LABELS = [
  "italy",
  "eu country",
  "eu",
  "non-eu country",
  "non-eu",
  "non eu",
  "entrance exam",
  "qualification required",
  "fees and amounts",
  "requirements",
  "deadlines",
  "how to enrol",
];

function isPrioritySection(label: string): boolean {
  const n = label.toLowerCase().trim();
  return PRIORITY_SECTION_LABELS.some((p) => n.includes(p) || p.includes(n));
}

/**
 * Extract clean text, internal links, and tab/accordion sections from HTML DOM.
 * Hidden accordion/tab text in the DOM is included when present.
 */
export function extractFromHtml(
  html: string,
  pageUrl: string
): ExtractedPage {
  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const title = titleMatch ? stripTags(titleMatch[1]).slice(0, 300) : null;

  const links: ClassifiedLink[] = [];
  const linkRe = /<a\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let m: RegExpExecArray | null;
  let linkIdx = 0;
  while ((m = linkRe.exec(html)) !== null) {
    const hrefRaw = m[1].trim();
    if (!hrefRaw || hrefRaw.startsWith("#") || hrefRaw.startsWith("javascript:")) {
      continue;
    }
    let absolute: string;
    try {
      absolute = new URL(hrefRaw, pageUrl).toString();
    } catch {
      continue;
    }
    const label = stripTags(m[2]).slice(0, 200) || absolute;
    const linkId = `L${++linkIdx}`;
    links.push({
      linkId,
      label,
      url: absolute,
      classification: classifyLink(label, absolute),
    });
  }

  const sections: PageSection[] = [];
  let sectionIdx = 0;

  // role=tab / aria panels
  const tabRe =
    /<(?:button|a|div|li)[^>]*(?:role=["']tab["']|data-tab|aria-controls)[^>]*>([\s\S]*?)<\/(?:button|a|div|li)>/gi;
  while ((m = tabRe.exec(html)) !== null) {
    const label = stripTags(m[1]).slice(0, 120);
    if (!label || label.length < 2) continue;
    sections.push({
      sectionId: `S${++sectionIdx}`,
      label,
      kind: "tab",
      text: "",
    });
  }

  // details/summary accordions
  const detailsRe = /<details\b[^>]*>([\s\S]*?)<\/details>/gi;
  while ((m = detailsRe.exec(html)) !== null) {
    const block = m[1];
    const summary = block.match(/<summary\b[^>]*>([\s\S]*?)<\/summary>/i);
    const label = summary ? stripTags(summary[1]).slice(0, 120) : "Accordion";
    const text = stripTags(block).slice(0, 8000);
    sections.push({
      sectionId: `S${++sectionIdx}`,
      label,
      kind: "accordion",
      text,
    });
  }

  // Common Unibo-style panels with data-target / aria-labelledby
  const panelRe =
    /<(?:div|section)[^>]*(?:class=["'][^"']*(?:tab-pane|accordion|collapse|panel)[^"']*["']|id=["']([^"']+)["'])[^>]*>([\s\S]*?)<\/(?:div|section)>/gi;
  while ((m = panelRe.exec(html)) !== null) {
    const id = m[1] || "";
    const text = stripTags(m[2]).slice(0, 8000);
    if (text.length < 40) continue;
    const labelGuess =
      id.replace(/[-_]/g, " ").slice(0, 80) || text.slice(0, 40);
    if (!isPrioritySection(labelGuess) && text.length < 120) continue;
    sections.push({
      sectionId: `S${++sectionIdx}`,
      label: labelGuess,
      kind: isPrioritySection(labelGuess) ? "tab" : "other",
      text,
    });
  }

  // Fill empty tab labels with nearby heading text if needed
  for (const s of sections) {
    if (!s.text && isPrioritySection(s.label)) {
      const re = new RegExp(
        `${escapeRegExp(s.label)}([\\s\\S]{0,4000})`,
        "i"
      );
      const hit = stripTags(html).match(re);
      if (hit) s.text = hit[0].slice(0, 8000);
    }
  }

  const cleanText = stripTags(html).slice(0, 100_000);
  return { title, cleanText, links, sections };
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Strip noisy chrome for change detection (footer/menu/cookies). */
export function relevantPageFingerprint(text: string): string {
  return text
    .toLowerCase()
    .replace(/cookie[s]?[\s\S]{0,400}/gi, " ")
    .replace(/privacy[\s\S]{0,200}/gi, " ")
    .replace(/menu|footer|header|nav\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 50_000);
}

export { stripTags };
