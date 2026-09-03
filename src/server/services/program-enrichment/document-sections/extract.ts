import { createHash } from "node:crypto";
import {
  extractFromHtml,
  stripTags,
  type PageSection,
} from "../html-extract";
import {
  classifySectionType,
  detectAcademicYear,
  detectCategoryHints,
  looksLikeHtml,
} from "./classify";
import {
  MAX_SECTION_CHARS,
  SECTION_OVERLAP_CHARS,
  type ExtractedSection,
  type HtmlKind,
  type SectionMetadata,
  type SectionType,
} from "./types";

const MIN_SECTION_CHARS = 24;

const HEADING_LINE =
  /^(?:#{1,6}\s+\S|art(?:icolo|\.)?\s*\d+|(?:\d+\.)+\s+\S)/i;

const MARKER_HEADING =
  /^(requisiti(?:\s+di\s+ammissione)?|ammissione|admission(?:\s+(?:test|requirements?|call))?|modalit[aà]\s+di\s+accesso|accesso|how to enrol|entrance exam|prove? d['']ingresso|selezione|concorso|lingua|language requirements?|posti(?:\s+riservati)?|seats|tasse|tuition|fees|contribuzione|scadenze?|deadlines?|documenti(?:\s+richiesti)?|required documents?)\b/i;

const CUE_SPLITTERS: Array<{ type: SectionType; re: RegExp }> = [
  {
    type: "EXAMS",
    re: /\b(admission test|entrance exam|prova (?:di ammissione|in ingresso)|tolc(?:-[a-z0-9]+)?|imat|sat\b|cisia|colloquio|verifica delle conoscenze)\b/gi,
  },
  {
    type: "ADMISSION",
    re: /\b(requisiti di ammissione|modalit[aà] di accesso|accesso libero|numero programmato|how to enrol|ammissione)\b/gi,
  },
  {
    type: "LANGUAGE",
    re: /\b(language requirements?|requisito linguistico|english [abc][12]|certificazione di inglese|taught in english|ielts|toefl)\b/gi,
  },
  {
    type: "SEATS",
    re: /\b(posti riservati|posti non-eu|posti extra-ue|\d+\s*posti|seats?)\b/gi,
  },
  {
    type: "DEADLINES",
    re: /\b(scadenze? domande|application deadlines?|scadenze?|deadlines?)\b/gi,
  },
  {
    type: "TUITION",
    re: /\b(tasse|tuition|fees|contribuzione|contributo onnicomprensivo)\b/gi,
  },
  {
    type: "DOCUMENTS",
    re: /\b(documenti richiesti|required documents?|allegati)\b/gi,
  },
];

type RawBlock = {
  heading: string;
  text: string;
  index: number;
  htmlKind: HtmlKind;
};

function hashText(text: string): string {
  return createHash("sha256").update(text.trim()).digest("hex");
}

function compact(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function isHeadingLine(line: string): boolean {
  const t = line.trim();
  if (t.length < 3 || t.length > 140) return false;
  if (HEADING_LINE.test(t)) return true;
  if (MARKER_HEADING.test(t) && t.length <= 100) return true;
  if (
    t === t.toUpperCase() &&
    /[A-Z]{4,}/.test(t) &&
    t.split(/\s+/).length <= 10 &&
    t.length <= 80
  ) {
    return true;
  }
  return false;
}

function splitLongText(text: string): string[] {
  const trimmed = text.trim();
  if (trimmed.length <= MAX_SECTION_CHARS) return [trimmed];
  const parts: string[] = [];
  let start = 0;
  while (start < trimmed.length) {
    let end = Math.min(start + MAX_SECTION_CHARS, trimmed.length);
    if (end < trimmed.length) {
      const window = trimmed.slice(start, end);
      const breakAt = Math.max(
        window.lastIndexOf("\n\n"),
        window.lastIndexOf(". "),
        window.lastIndexOf("; ")
      );
      if (breakAt > MAX_SECTION_CHARS * 0.45) {
        end = start + breakAt + 1;
      }
    }
    const slice = trimmed.slice(start, end).trim();
    if (slice.length >= MIN_SECTION_CHARS) parts.push(slice);
    if (end >= trimmed.length) break;
    start = Math.max(end - SECTION_OVERLAP_CHARS, start + 1);
  }
  return parts.length ? parts : [trimmed.slice(0, MAX_SECTION_CHARS)];
}

function finalizeBlocks(
  blocks: RawBlock[],
  extras: Pick<SectionMetadata, "sourceAuthority" | "sourceType" | "academicYearHint">
): ExtractedSection[] {
  const deduped = dedupeBlocks(blocks.filter((b) => compact(b.text).length >= MIN_SECTION_CHARS));
  const out: ExtractedSection[] = [];
  let position = 0;
  for (const block of deduped) {
    const heading = compact(block.heading).slice(0, 200);
    const parts = splitLongText(compact(block.text));
    parts.forEach((part, splitIndex) => {
      const metadata: SectionMetadata = {
        applicantCategoryHints: detectCategoryHints(heading, part),
        academicYearHint: detectAcademicYear(
          heading,
          part,
          extras.academicYearHint
        ),
        sourceAuthority: extras.sourceAuthority ?? null,
        sourceType: extras.sourceType ?? null,
        parentHeading: parts.length > 1 ? heading : null,
        splitIndex: parts.length > 1 ? splitIndex : undefined,
        htmlKind: block.htmlKind,
      };
      out.push({
        heading,
        sectionType: classifySectionType(heading, part),
        position,
        text: part,
        contentHash: hashText(part),
        metadata,
      });
      position += 1;
    });
  }
  return out;
}

function dedupeBlocks(blocks: RawBlock[]): RawBlock[] {
  const sorted = [...blocks].sort((a, b) => a.index - b.index);
  const kept: RawBlock[] = [];
  const typePriority: Record<SectionType, number> = {
    EXAMS: 8,
    ADMISSION: 7,
    LANGUAGE: 6,
    SEATS: 6,
    DOCUMENTS: 5,
    DEADLINES: 4,
    TUITION: 4,
    GENERAL: 1,
  };
  for (const block of sorted) {
    const text = compact(block.text);
    const overlapIdx = kept.findIndex((existing) => {
      const other = compact(existing.text);
      return (
        text === other ||
        (text.length > 80 && other.includes(text)) ||
        (other.length > 80 && text.includes(other))
      );
    });
    if (overlapIdx < 0) {
      kept.push(block);
      continue;
    }
    const overlap = kept[overlapIdx];
    const specific = classifySectionType(block.heading, block.text);
    const existingType = classifySectionType(overlap.heading, overlap.text);
    if (specific === existingType) {
      if (text.length > compact(overlap.text).length) kept[overlapIdx] = block;
      continue;
    }
    // Different types: keep both when one is only a nested fragment of the other.
    if (text !== compact(overlap.text)) {
      kept.push(block);
      continue;
    }
    if ((typePriority[specific] ?? 0) > (typePriority[existingType] ?? 0)) {
      kept[overlapIdx] = block;
    }
  }
  return kept;
}

function headingBlocksFromHtml(html: string): RawBlock[] {
  const headingRe = /<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1>/gi;
  const matches: Array<{ heading: string; index: number; end: number }> = [];
  let m: RegExpExecArray | null;
  while ((m = headingRe.exec(html)) !== null) {
    matches.push({
      heading: stripTags(m[2]).slice(0, 200),
      index: m.index,
      end: m.index + m[0].length,
    });
  }
  if (matches.length === 0) return [];
  return matches.map((match, i) => {
    const from = match.end;
    const to = i + 1 < matches.length ? matches[i + 1].index : html.length;
    return {
      heading: match.heading,
      text: stripTags(html.slice(from, to)),
      index: match.index,
      htmlKind: "heading" as const,
    };
  });
}

function tableBlocksFromHtml(html: string): RawBlock[] {
  const tableRe = /<table\b[^>]*>([\s\S]*?)<\/table>/gi;
  const blocks: RawBlock[] = [];
  let m: RegExpExecArray | null;
  while ((m = tableRe.exec(html)) !== null) {
    const inner = m[1];
    const caption = inner.match(/<caption\b[^>]*>([\s\S]*?)<\/caption>/i);
    const heading = caption ? stripTags(caption[1]) : "Table";
    const text = stripTags(inner);
    if (text.length < 40) continue;
    blocks.push({
      heading: heading.slice(0, 200),
      text,
      index: m.index,
      htmlKind: "table",
    });
  }
  return blocks;
}

function semanticBlocksFromHtml(html: string): RawBlock[] {
  const re =
    /<(main|article|section)\b[^>]*>([\s\S]*?)<\/\1>/gi;
  const blocks: RawBlock[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const text = stripTags(m[2]);
    if (text.length < 80) continue;
    const headingMatch = m[2].match(/<h[1-6]\b[^>]*>([\s\S]*?)<\/h[1-6]>/i);
    blocks.push({
      heading: headingMatch ? stripTags(headingMatch[1]) : stripTags(m[1]),
      text,
      index: m.index,
      htmlKind: "semantic",
    });
  }
  return blocks;
}

function pageSectionBlocks(html: string, pageUrl: string): RawBlock[] {
  const extracted = extractFromHtml(html, pageUrl);
  return extracted.sections
    .filter((s: PageSection) => compact(s.text).length >= MIN_SECTION_CHARS)
    .map((s, i) => ({
      heading: s.label,
      text: s.text,
      index: i,
      htmlKind: (s.kind === "tab" || s.kind === "accordion" ? s.kind : "plain") as HtmlKind,
    }));
}

function cueBlocksFromText(text: string): RawBlock[] {
  const hits: Array<{ type: SectionType; index: number; label: string }> = [];
  for (const cue of CUE_SPLITTERS) {
    const re = new RegExp(cue.re.source, "gi");
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      hits.push({ type: cue.type, index: m.index, label: m[0] });
    }
  }
  hits.sort((a, b) => a.index - b.index);
  if (hits.length === 0) return [];
  return hits.map((hit, i) => {
    // Do not cut at the very next keyword: a compact sentence such as
    // "Admission test: CISIA TOLC-I" contains three valid cues. Splitting
    // at every hit made all the exam fragments shorter than MIN_SECTION_CHARS
    // and silently removed them from retrieval. Keep the surrounding sentence
    // (or paragraph) instead, then let deduplication merge overlapping cues.
    const boundaryBefore = Math.max(
      text.lastIndexOf("\n\n", hit.index),
      text.lastIndexOf("\n", hit.index),
      text.lastIndexOf(". ", hit.index),
      text.lastIndexOf("; ", hit.index)
    );
    const start = Math.max(0, boundaryBefore + (boundaryBefore >= 0 ? 1 : 0));
    const after = text.slice(hit.index);
    const boundaryMatch = after.match(/[.!?](?:\s|$)|\n\n|\n/);
    let end = boundaryMatch
      ? hit.index + boundaryMatch.index! + boundaryMatch[0].length
      : Math.min(text.length, start + 1_600);

    // A one-word cue can still be a real requirement. Add enough following
    // context for validation and classification without collapsing the entire
    // document into one section.
    if (end - start < MIN_SECTION_CHARS) {
      const next = i + 1 < hits.length ? hits[i + 1].index : text.length;
      end = Math.min(text.length, Math.max(end, next, start + 400));
    }
    return {
      heading: hit.label,
      text: text.slice(start, end),
      index: start,
      htmlKind: "cue" as const,
    };
  });
}

function lineHeadingBlocks(text: string): RawBlock[] {
  const lines = text.split(/\r?\n/);
  const headingIdx: number[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (isHeadingLine(lines[i])) headingIdx.push(i);
  }
  if (headingIdx.length === 0) {
    const colonHeadings: number[] = [];
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (MARKER_HEADING.test(line) || /^(language requirements?|admission test|scadenza)/i.test(line)) {
        colonHeadings.push(i);
      }
    }
    if (colonHeadings.length === 0) return [];
    headingIdx.push(...colonHeadings);
  }

  let charAt = 0;
  const lineStarts: number[] = [];
  for (let i = 0; i < lines.length; i++) {
    lineStarts[i] = charAt;
    charAt += lines[i].length + 1;
  }

  return headingIdx.map((lineNo, i) => {
    const from = lineNo;
    const to = i + 1 < headingIdx.length ? headingIdx[i + 1] : lines.length;
    const heading = lines[from].trim();
    const body = lines.slice(from, to).join("\n");
    return {
      heading,
      text: body,
      index: lineStarts[from] ?? from,
      htmlKind: "plain" as const,
    };
  });
}

export function extractSectionsFromHtml(
  html: string,
  extras: Pick<SectionMetadata, "sourceAuthority" | "sourceType"> & {
    academicYear?: string | null;
    pageUrl?: string;
  } = {}
): ExtractedSection[] {
  const pageUrl = extras.pageUrl || "https://local.invalid/";
  const blocks: RawBlock[] = [
    ...headingBlocksFromHtml(html),
    ...pageSectionBlocks(html, pageUrl),
    ...tableBlocksFromHtml(html),
  ];
  if (blocks.length === 0) {
    blocks.push(...semanticBlocksFromHtml(html));
  }
  if (blocks.length === 0) {
    return extractSectionsFromText(stripTags(html), extras);
  }
  const withCues = [
    ...blocks,
    ...cueBlocksFromText(stripTags(html)),
  ];
  return finalizeBlocks(withCues, {
    sourceAuthority: extras.sourceAuthority,
    sourceType: extras.sourceType,
    academicYearHint: extras.academicYear ?? null,
  });
}

export function extractSectionsFromText(
  text: string,
  extras: Pick<SectionMetadata, "sourceAuthority" | "sourceType"> & {
    academicYear?: string | null;
  } = {}
): ExtractedSection[] {
  const normalized = text.replace(/\u00a0/g, " ").trim();
  if (!normalized) return [];
  const blocks = [
    ...lineHeadingBlocks(normalized),
    ...cueBlocksFromText(normalized),
  ];
  if (blocks.length === 0) {
    blocks.push({
      heading: "",
      text: normalized,
      index: 0,
      htmlKind: "plain",
    });
  }
  return finalizeBlocks(blocks, {
    sourceAuthority: extras.sourceAuthority,
    sourceType: extras.sourceType,
    academicYearHint: extras.academicYear ?? null,
  });
}

export function extractDocumentSections(input: {
  html?: string;
  text?: string;
  contentType?: string;
  sourceType?: string | null;
  sourceAuthority?: string | null;
  academicYear?: string | null;
  pageUrl?: string;
}): ExtractedSection[] {
  const extras = {
    sourceAuthority: input.sourceAuthority,
    sourceType: input.sourceType,
    academicYear: input.academicYear,
    pageUrl: input.pageUrl,
  };
  if (input.html?.trim()) {
    return extractSectionsFromHtml(input.html, extras);
  }
  const body = input.text || "";
  if ((input.contentType === "html" || looksLikeHtml(body)) && looksLikeHtml(body)) {
    return extractSectionsFromHtml(body, extras);
  }
  return extractSectionsFromText(body, extras);
}
