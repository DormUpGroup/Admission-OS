import { inferPublicPrivateFromDocumentText } from "@/server/services/program-ingestion/infer-public-private";
import {
  inferAdmissionRegime,
  type AdmissionRegime,
} from "@/server/services/program-ingestion/admission-regime";

export type FieldConfidence = "HIGH" | "MEDIUM" | "LOW";

export type CallExam = { name: string; detail?: string };

export type CallField<T> = {
  value: T;
  confidence: FieldConfidence;
  snippet?: string;
};

export type ScopedQuotaRow = {
  category:
    | "EU_CITIZEN"
    | "EU_EQUIVALENT"
    | "NON_EU_RESIDENT_ITALY"
    | "NON_EU_RESIDENT_ABROAD"
    | "UNMAPPED";
  originalGroup: string;
  places: number;
  categoryCode?: string;
  confidence: FieldConfidence;
  snippet: string;
};

export type CallTextParseQuality = "OK" | "LOW" | "EMPTY";

export type CallTextParse = {
  url: string;
  academicYear?: string;
  languages: string[];
  languageLevel: CallField<string> | null;
  tuitionMin: CallField<number> | null;
  tuitionMax: CallField<number> | null;
  tuitionFixed: CallField<number> | null;
  incomeBased: boolean;
  /** When fees page applies to all students of the university. */
  tuitionScope: "programme" | "university-wide" | null;
  deadlines: Array<CallField<string>>;
  accessMode: CallField<"OPEN" | "CLOSED" | "UNKNOWN">;
  euSeats: CallField<number> | null;
  nonEuSeats: CallField<number> | null;
  totalSeats: CallField<number> | null;
  quotaRows: ScopedQuotaRow[];
  exams: CallExam[];
  examAlternatives: CallExam[];
  examsConfidence: FieldConfidence;
  admissionGate: boolean;
  evaluationOnly: boolean;
  admissionRegime: AdmissionRegime;
  careerOutcomes: CallField<string> | null;
  publicPrivate: "PUBLIC" | "PRIVATE" | "UNKNOWN";
  mentionsTuition: boolean;
  mentionsDeadline: boolean;
  quality: CallTextParseQuality;
};

const MONTH_NAMES =
  "January|February|March|April|May|June|July|August|September|October|November|December|gennaio|febbraio|marzo|aprile|maggio|giugno|luglio|agosto|settembre|ottobre|novembre|dicembre";

const SECTION_CUE =
  /\b(tasse|contribuzione|tuition|fees|amounts|requisiti|requirements|ammissione|admission|posti|seats|scadenze|scadenza|deadlines?|sbocchi|career|lingua|language|cef|qcer)\b/gi;

/** Prefer main/article content; always strip scripts/styles (Unito-like CMS shells). */
export function extractHtmlMainText(body: string): string {
  const html = body
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ");

  const candidates = [
    html.match(/<main\b[^>]*>([\s\S]*?)<\/main>/i)?.[1],
    html.match(/<article\b[^>]*>([\s\S]*?)<\/article>/i)?.[1],
    html.match(
      /<(?:div|section)[^>]*(?:id|class)=["'][^"']*(?:content|main-content|page-content|testo|entry-content|region-content)[^"']*["'][^>]*>([\s\S]*?)<\/(?:div|section)>/i
    )?.[1],
  ].filter((c): c is string => !!c);

  const toText = (chunk: string) =>
    chunk
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/gi, " ")
      .replace(/&amp;/gi, "&")
      .replace(/&euro;/gi, "€")
      .replace(/\s+/g, " ")
      .trim();

  let best = "";
  for (const c of candidates) {
    const t = toText(c);
    if (t.replace(/\s+/g, "").length > best.replace(/\s+/g, "").length) best = t;
  }
  const full = toText(html);
  if (best.replace(/\s+/g, "").length >= 120) return best;
  return full;
}

function stripHtml(body: string): string {
  return extractHtmlMainText(body);
}

function linesOf(text: string): string[] {
  return text
    .split(/\r?\n|(?<=[.!?])\s+/)
    .map((l) => l.trim())
    .filter((l) => l.length > 8);
}

/** Split text into heading windows keyed by section cue. */
export function headingWindows(text: string): Map<string, string> {
  const windows = new Map<string, string>();
  const matches: Array<{ key: string; index: number }> = [];
  const re = new RegExp(SECTION_CUE.source, "gi");
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    matches.push({ key: m[1].toLowerCase(), index: m.index });
  }
  if (matches.length === 0) {
    windows.set("all", text);
    return windows;
  }
  for (let i = 0; i < matches.length; i++) {
    const start = matches[i].index;
    const end = i + 1 < matches.length ? matches[i + 1].index : text.length;
    const chunk = text.slice(start, Math.min(end, start + 1200));
    const key = matches[i].key;
    const prev = windows.get(key) || "";
    windows.set(key, (prev + " " + chunk).trim());
  }
  windows.set("all", text);
  return windows;
}

function windowFor(
  windows: Map<string, string>,
  keys: string[]
): string {
  const parts: string[] = [];
  for (const k of keys) {
    const v = windows.get(k);
    if (v) parts.push(v);
  }
  return parts.join(" ") || windows.get("all") || "";
}

const EURO_AMOUNT = "([0-9]{1,3}(?:[.,][0-9]{3})+|\\d{1,5}(?:[.,]\\d{2})?)";

function parseEuroToken(raw: string): number {
  const normalized = raw.includes(",") && !raw.includes(".")
    ? raw.replace(/\./g, "").replace(",", ".")
    : raw.replace(/\./g, "").replace(",", ".");
  const n = Number(normalized);
  return Number.isFinite(n) ? Math.round(n) : NaN;
}

export function sanitizeTuitionPair(
  min: number | null | undefined,
  max: number | null | undefined
): { min: number | null; max: number | null } {
  let lo = min ?? null;
  let hi = max ?? null;
  if (lo != null && lo > 0 && lo < 100) lo = null;
  if (hi != null && hi > 0 && hi < 100) hi = null;
  if (lo != null && hi != null && lo > hi) {
    const swap = lo;
    lo = hi;
    hi = swap;
  }
  return { min: lo, max: hi };
}

function extractEuroAmounts(text: string): number[] {
  const amounts: number[] = [];
  const re = new RegExp(`(?:€|EUR|euro)\\s*${EURO_AMOUNT}`, "gi");
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const n = parseEuroToken(m[1]);
    if (Number.isFinite(n) && (n === 0 || (n >= 100 && n < 100_000))) {
      amounts.push(n);
    }
  }
  const re2 = /\b(\d{2,5})\s*(?:€|EUR|euro)/gi;
  while ((m = re2.exec(text)) !== null) {
    const n = Number(m[1]);
    if (Number.isFinite(n) && n >= 100 && n < 100_000) amounts.push(n);
  }
  return [...new Set(amounts)].sort((a, b) => a - b);
}

function extractDaARange(text: string): { min: number; max: number; snippet: string } | null {
  const patterns = [
    `(?:contributo\\s+onnicomprensivo|importo)\\s+(?:compreso\\s+)?tra\\s*(?:€|EUR|euro)?\\s*${EURO_AMOUNT}\\s*(?:e|and|a|to|ed)\\s*(?:€|EUR|euro)?\\s*${EURO_AMOUNT}`,
    `importo\\s+compreso\\s+tra\\s*(?:€|EUR|euro)?\\s*${EURO_AMOUNT}\\s*(?:e|and|a|to)\\s*(?:€|EUR|euro)?\\s*${EURO_AMOUNT}`,
    `(?:da|from|ranging\\s+between|between|compreso\\s+tra)\\s*(?:€|EUR|euro)?\\s*${EURO_AMOUNT}\\s*(?:a|to|e|and|ed|–|-|fino\\s+a)\\s*(?:€|EUR|euro)?\\s*${EURO_AMOUNT}`,
    `(?:annual\\s+)?(?:tuition|fee|fees)\\s+(?:of\\s+)?(?:from\\s+)?(?:€|EUR|euro)?\\s*${EURO_AMOUNT}\\s*(?:to|–|-)\\s*(?:€|EUR|euro)?\\s*${EURO_AMOUNT}`,
  ];
  for (const source of patterns) {
    const m = text.match(new RegExp(source, "i"));
    if (!m) continue;
    const min = parseEuroToken(m[1]);
    const max = parseEuroToken(m[2]);
    if (!Number.isFinite(min) || !Number.isFinite(max)) continue;
    if (min > 0 && min < 100 && max >= 1000) return { min: max, max, snippet: m[0].slice(0, 120) };
    if (min > 0 && min < 100) continue;
    return { min, max, snippet: m[0].slice(0, 120) };
  }
  return null;
}

/** One-sided bound: only max ("fino a / up to / max") or only min ("da / from / min" without upper). */
function extractSingleTuitionBound(text: string): {
  min: number | null;
  max: number | null;
  snippet: string;
} | null {
  const maxOnly = text.match(
    new RegExp(
      `(?:fino\\s+a|up\\s+to|massimo|max\\.?|non\\s+oltre|ceiling)\\s*(?:di\\s+)?(?:€|EUR|euro)?\\s*${EURO_AMOUNT}`,
      "i"
    )
  );
  if (maxOnly) {
    const max = Math.round(
      Number(maxOnly[1].replace(/\./g, "").replace(",", "."))
    );
    if (Number.isFinite(max) && max >= 0) {
      return { min: null, max, snippet: maxOnly[0].slice(0, 120) };
    }
  }
  // "da €156" / "from €156" / "minimo €156" without following "a/to"
  const minOnly = text.match(
    /(?:^|[^\w])(?:da|from|minimo|min\.?|starting\s+(?:from|at))\s*(?:€|EUR|euro)?\s*([0-9]{1,3}(?:[.,][0-9]{3})?|\d+)(?!\s*(?:a|to|–|-)\s*(?:€|EUR|euro|\d))/i
  );
  if (minOnly) {
    const min = Math.round(
      Number(minOnly[1].replace(/\./g, "").replace(",", "."))
    );
    if (Number.isFinite(min) && (min === 0 || min >= 100)) {
      return { min, max: null, snippet: minOnly[0].slice(0, 120) };
    }
  }
  return null;
}

function extractDateTokens(text: string): string[] {
  const out: string[] = [];
  const iso = text.match(/\b(20\d{2})-(\d{2})-(\d{2})\b/g) || [];
  out.push(...iso);
  const dmy =
    text.match(/\b(\d{1,2})[\/.\-](\d{1,2})[\/.\-](20\d{2})\b/g) || [];
  out.push(...dmy);
  const months =
    text.match(
      new RegExp(`\\b(\\d{1,2})\\s+(${MONTH_NAMES})\\s+(20\\d{2})\\b`, "gi")
    ) || [];
  out.push(...months);
  return [...new Set(out)];
}

function extractCefr(text: string): CallField<string> | null {
  const patterns: Array<{ re: RegExp; conf: FieldConfidence }> = [
    {
      re: /\b(?:English|Inglese|Italian|Italiano)[^.\n]{0,50}\b(A1|A2|B1|B2|C1|C2)\b/i,
      conf: "HIGH",
    },
    {
      re: /\b(?:livello|level|CEFR|QCER|certificazione|certificat[oe]|requisito\s+linguistico|language\s+requirement|english\s+(?:language\s+)?(?:proficiency|requirement))[^.\n]{0,60}\b(A1|A2|B1|B2|C1|C2)\b/i,
      conf: "HIGH",
    },
    {
      re: /\b(A1|A2|B1|B2|C1|C2)\b(?:\s+or\s+equivalent)?[^.\n]{0,40}(?:English|Inglese|Italian|Italiano|CEFR|QCER)/i,
      conf: "HIGH",
    },
    {
      re: /\b(?:proficiency|knowledge)\s+(?:of|in)\s+(?:the\s+)?(?:English|Inglese)[^.\n]{0,50}\b(A1|A2|B1|B2|C1|C2)\b/i,
      conf: "HIGH",
    },
    {
      re: /\b(?:English|Inglese)\s+(?:language\s+)?(?:requirement|proficiency)[^.\n]{0,50}\b(A1|A2|B1|B2|C1|C2)\b/i,
      conf: "HIGH",
    },
    {
      re: /\bCambridge[^.\n]{0,30}\b(B1|B2|C1|C2)\b/i,
      conf: "MEDIUM",
    },
    {
      re: /\bIELTS[^.\n]{0,20}(?:≥|>=|min(?:imum)?\.?|at\s+least)?\s*(6\.5|7\.0|7|6\.0|6|5\.5)/i,
      conf: "MEDIUM",
    },
    {
      re: /\bTOEFL[^.\n]{0,30}(?:≥|>=|min(?:imum)?\.?|at\s+least)?\s*(80|90|100|72|88|95)/i,
      conf: "MEDIUM",
    },
  ];
  for (const { re, conf } of patterns) {
    const m = text.match(re);
    if (!m) continue;
    if (/IELTS/i.test(m[0])) {
      const score = Number(m[1]);
      const level = score >= 7 ? "C1" : score >= 6.5 ? "B2" : score >= 5.5 ? "B2" : "B1";
      return { value: level, confidence: conf, snippet: m[0].slice(0, 120) };
    }
    if (/TOEFL/i.test(m[0])) {
      const score = Number(m[1]);
      const level = score >= 95 ? "C1" : score >= 72 ? "B2" : "B1";
      return { value: level, confidence: conf, snippet: m[0].slice(0, 120) };
    }
    return {
      value: m[1].toUpperCase(),
      confidence: conf,
      snippet: m[0].slice(0, 120),
    };
  }
  return null;
}

function extractCareer(text: string, windows: Map<string, string>): CallField<string> | null {
  const careerText =
    windowFor(windows, ["sbocchi", "career"]) || text;
  const patterns = [
    /(?:career opportunities|sbocchi professionali|occupational outcomes|job opportunities|sbocchi)[:\s]+(.{20,500}?)(?:\n\n|<h\d|$)/i,
    /(?:graduates (?:will|can)|dopo la laurea|i laureati)[:\s]+(.{20,500}?)(?:\n\n|<h\d|$)/i,
  ];
  for (const re of patterns) {
    const m = careerText.match(re);
    if (m?.[1] && typeof m[1] === "string") {
      const cleaned = m[1]
        .replace(/<[^>]+>/g, " ")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 500);
      return { value: cleaned, confidence: "MEDIUM", snippet: cleaned.slice(0, 120) };
    }
  }
  return null;
}

function extractExams(text: string): {
  exams: CallExam[];
  alternatives: CallExam[];
  confidence: FieldConfidence;
  admissionGate: boolean;
  evaluationOnly: boolean;
} {
  const exams: CallExam[] = [];
  const alternatives: CallExam[] = [];

  if (/\b(?:CISIA\s+)?TOLC(?:-[A-Z]+)?\b/i.test(text)) {
    const tolc = text.match(/\bTOLC-[A-Z]+\b/i)?.[0] || "TOLC";
    exams.push({ name: tolc.toUpperCase() });
  }
  if (/\bSAT\b/i.test(text)) {
    const satScore = text.match(/\bSAT[^.\n]{0,30}?(\d{3,4})\b/i);
    exams.push({
      name: "SAT",
      detail: satScore ? `≥ ${satScore[1]}` : undefined,
    });
  }
  if (/\bIMAT\b/i.test(text)) exams.push({ name: "IMAT" });
  if (/\bbocconi(?:\s+online)?\s+test\b|\btest\s+bocconi\b/i.test(text)) {
    exams.push({ name: "BOCCONI_TEST" });
  }
  if (/\bACT\b/i.test(text)) exams.push({ name: "ACT" });
  // IELTS / TOEFL / CILS are language evidence, never admission exams.
  const mentionsAdmissionTest =
    /prova\s+di\s+ammissione|admission\s+test|entrance\s+test|test\s+d['’]ingresso|test\s+di\s+ammissione/i.test(
      text
    ) &&
    !/non\s+[èe]\s+previsto\s+(?:un\s+)?(?:test|prova)|senza\s+(?:test|prova\s+di\s+ammissione)|no\s+(?:admission|entrance)\s+test/i.test(
      text
    );
  if (mentionsAdmissionTest) {
    if (!exams.some((e) => e.name === "ADMISSION_TEST" || e.name === "BOCCONI_TEST")) {
      exams.push({ name: "ADMISSION_TEST" });
    }
  }
  if (/\b(?:colloquio|interview)\b/i.test(text)) {
    exams.push({ name: "INTERVIEW" });
  }
  if (/\bportfolio\b/i.test(text)) {
    exams.push({ name: "PORTFOLIO" });
  }

  const orPattern =
    /\bSAT\b[^.\n]{0,40}\b(?:or|oppure|o)\b[^.\n]{0,40}\bTOLC/i.test(text) ||
    /\bTOLC\b[^.\n]{0,40}\b(?:or|oppure|o)\b[^.\n]{0,40}\bSAT/i.test(text) ||
    /\bone of the following\b[^.\n]{0,80}\b(?:SAT|TOLC)/i.test(text);

  if (orPattern) {
    const sat = exams.find((e) => e.name === "SAT");
    const tolc = exams.find((e) => e.name.startsWith("TOLC"));
    if (sat && tolc) {
      alternatives.push(sat, tolc);
    }
  }

  // mentionsAdmissionTest already excludes negated "non è previsto un test"
  const knowledgeVerificationOnly =
    /prova\s+in\s+ingresso[^.\n]{0,120}verifica\s+delle\s+conoscenze|verifica\s+delle\s+conoscenze|knowledge\s+(?:assessment|verification)|assessment\s+of\s+(?:entry\s+)?knowledge|test\s+di\s+valutazione/i.test(
      text
    );
  // Named admission exams (SAT/TOLC/IMAT/…) are always a real gate unless
  // the page is clearly a non-selective knowledge check.
  const namedAdmissionExam = exams.some((e) =>
    /^(SAT|TOLC(?:-[A-Z]+)?|IMAT|ACT|BOCCONI_TEST|ADMISSION_TEST)$/i.test(e.name)
  );
  const admissionGate =
    mentionsAdmissionTest ||
    (namedAdmissionExam && !knowledgeVerificationOnly) ||
    (/selezione|selection/i.test(text) &&
      !/senza\s+selezione|no\s+selection/i.test(text) &&
      !/prova\s+in\s+ingresso[^.\n]{0,120}verifica\s+delle\s+conoscenze/i.test(text));
  const evaluationOnly =
    (/(?:verifica|orientamento|assessment)[^.\n]{0,80}\b(?:TOLC|test)\b|\b(?:TOLC|test)\b[^.\n]{0,80}(?:verifica|orientamento|assessment)/i.test(
      text
    ) ||
      knowledgeVerificationOnly) &&
    !admissionGate;
  const confidence: FieldConfidence =
    alternatives.length >= 2 ? "HIGH" : exams.length > 0 ? "MEDIUM" : "LOW";

  return { exams, alternatives, confidence, admissionGate, evaluationOnly };
}

function quotaCategories(group: string): ScopedQuotaRow["category"][] {
  const normalized = group.toLowerCase();
  if (/marco\s+polo/.test(normalized)) return ["UNMAPPED"];

  const categories: Array<ScopedQuotaRow["category"]> = [];
  if (
    /non[\s-]?(?:eu|ue)[^.;]{0,100}(?:resid(?:ing|enti)|living)[^.;]{0,30}(?:abroad|outside\s+(?:of\s+)?italy|all['’]estero)|(?:abroad|outside\s+(?:of\s+)?italy|all['’]estero)[^.;]{0,100}non[\s-]?(?:eu|ue)/i.test(
      group
    )
  ) {
    categories.push("NON_EU_RESIDENT_ABROAD");
  }
  if (
    /non[\s-]?(?:eu|ue)[^.;]{0,120}(?:legally\s+residing|residenti|soggiornanti)[^.;]{0,30}(?:in\s+italy|in\s+italia)|(?:in\s+italy|in\s+italia)[^.;]{0,100}non[\s-]?(?:eu|ue)/i.test(
      group
    )
  ) {
    categories.push("NON_EU_RESIDENT_ITALY");
  }
  if (/\b(?:equivalents?|equivalent|equiparati|assimilati|assimilated)\b/i.test(group)) {
    categories.push("EU_EQUIVALENT");
  }
  if (
    /\b(?:italians?|italiani|(?<!non-)eu\s+citizens?|(?<!non-)eu\s+and|cittadini\s+(?:ue|comunitari)|comunitari)\b/i.test(
      group
    )
  ) {
    categories.push("EU_CITIZEN");
  }
  if (categories.length === 0) return ["UNMAPPED"];
  return [...new Set<ScopedQuotaRow["category"]>(categories)];
}

function quotaRowsFromChunks(chunks: string[]): ScopedQuotaRow[] {
  const rows: ScopedQuotaRow[] = [];
  for (const chunk of chunks) {
    if (!/\b(?:places|posti|seats|category|categoria|marco\s+polo)\b/i.test(chunk)) {
      continue;
    }
    const numbers = [...chunk.matchAll(/\b(\d{1,4})\b/g)].map((match) => ({
      value: Number(match[1]),
      raw: match[1],
    }));
    if (numbers.length === 0) continue;
    const code = chunk.match(/\b(?:category|categoria)\s*(\d{3,4})\b/i)?.[1];
    const placeMentions = chunk.match(/\b(?:places|posti|seats)\b/gi) || [];
    if (!code && placeMentions.length > 1) continue;
    const candidates = code
      ? numbers.filter((number) => number.raw !== code)
      : numbers;
    const places = candidates.at(-1)?.value;
    if (places == null || places > 5000) continue;
    const originalGroup = chunk
      .replace(/\b(?:category|categoria)\s*\d{3,4}\b/i, "")
      .replace(/\b\d{1,4}\s*(?:places|posti|seats)\b/i, "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 500);
    for (const category of quotaCategories(originalGroup || chunk)) {
      rows.push({
        category,
        originalGroup: originalGroup || chunk.slice(0, 500),
        places,
        categoryCode: code,
        confidence: category === "UNMAPPED" ? "LOW" : "HIGH",
        snippet: chunk.slice(0, 500),
      });
    }
  }
  return rows.filter(
    (row, index, all) =>
      all.findIndex(
        (candidate) =>
          candidate.category === row.category &&
          candidate.categoryCode === row.categoryCode &&
          candidate.places === row.places
      ) === index
  );
}

export function extractScopedQuotaRows(body: string): ScopedQuotaRow[] {
  const htmlRows = (body.match(/<tr[\s\S]*?<\/tr>/gi) || []).map((row) =>
    row.replace(/<[^>]+>/g, " ").replace(/&nbsp;/gi, " ").replace(/\s+/g, " ").trim()
  );
  const text = stripHtml(body);
  const categoryChunks = text
    .split(/(?=\b(?:Category|Categoria)\s+\d{3,4}\b)/i)
    .filter(Boolean)
    .map((chunk) => chunk.slice(0, 700));
  const inlineChunks: string[] = [];
  if (htmlRows.length === 0) {
    for (const match of text.matchAll(
      /\b(\d{1,4})\s*(?:places|posti|seats)\s*(?:for|per|:)?\s*([^+;.\n]{3,220})/gi
    )) {
      inlineChunks.push(match[0]);
    }
    for (const match of text.matchAll(
      /([^+;.\n]{3,180}?)\s*[:–—-]\s*(\d{1,4})\s*(?:places|posti|seats)\b/gi
    )) {
      inlineChunks.push(match[0]);
    }
  }
  return quotaRowsFromChunks([
    ...htmlRows,
    ...categoryChunks,
    ...inlineChunks,
  ]);
}

function extractAccess(
  text: string,
  windows: Map<string, string>
): {
  accessMode: CallField<"OPEN" | "CLOSED" | "UNKNOWN">;
  euSeats: CallField<number> | null;
  nonEuSeats: CallField<number> | null;
  totalSeats: CallField<number> | null;
} {
  let mode: "OPEN" | "CLOSED" | "UNKNOWN" = "UNKNOWN";
  let modeConf: FieldConfidence = "LOW";
  let modeSnippet: string | undefined;

  const closed = text.match(
    /numero\s*programmato|programmed\s*number|closed\s*access|a\s*numero\s*programmato|accesso\s+programmato|programmed\s+access|entrance\s+exam\s+and\s+selection|sit\s+the\s+entrance\s+exam/i
  );
  const open = text.match(
    /accesso\s*libero|open\s*access|free\s*access|accesso\s+con\s+diploma|admission\s+with\s+(?:a\s+)?(?:high\s+school\s+)?diploma/i
  );
  const modalitaMatch = text.match(
    /modalit[aà]\s+di\s+accesso\s*[:\-]?\s*([^.\n]{5,160})/i
  );
  if (closed) {
    mode = "CLOSED";
    modeConf = "HIGH";
    modeSnippet = closed[0];
  } else if (open) {
    mode = "OPEN";
    modeConf = /accesso\s+con\s+diploma|admission\s+with/i.test(open[0])
      ? "MEDIUM"
      : "HIGH";
    modeSnippet = open[0];
  } else if (modalitaMatch) {
    const fragment = modalitaMatch[1];
    if (
      /accesso\s+libero|open\s+access|accesso\s+con\s+diploma|admission\s+with/i.test(
        fragment
      )
    ) {
      mode = "OPEN";
      modeConf = "HIGH";
      modeSnippet = modalitaMatch[0];
    } else if (/numero\s+programmato|programmed/i.test(fragment)) {
      mode = "CLOSED";
      modeConf = "HIGH";
      modeSnippet = modalitaMatch[0];
    } else if (
      /prova\s+in\s+ingresso|verifica\s+delle\s+conoscenze/i.test(fragment)
    ) {
      mode = "OPEN";
      modeConf = "MEDIUM";
      modeSnippet = modalitaMatch[0];
    }
  }

  if (
    mode === "UNKNOWN" &&
    /prova\s+in\s+ingresso[^.\n]{0,120}verifica\s+delle\s+conoscenze|verifica\s+delle\s+conoscenze/i.test(
      text
    )
  ) {
    mode = "OPEN";
    modeConf = "MEDIUM";
    modeSnippet =
      text.match(/prova\s+in\s+ingresso[^.\n]{0,120}/i)?.[0] ??
      "verifica delle conoscenze";
  }

  // Universitaly catalogue JSON sometimes lands in page/snapshot bodies.
  if (mode === "UNKNOWN") {
    const uniModalita = text.match(
      /"modalitaAccesso"\s*:\s*\{[^}]{0,200}?"descrizione"\s*:\s*"([^"]{3,80})"/i
    );
    if (uniModalita?.[1]) {
      const d = uniModalita[1].toLowerCase();
      if (/programmato/.test(d)) {
        mode = "CLOSED";
        modeConf = "LOW";
        modeSnippet = uniModalita[1];
      } else if (/accesso\s+con\s+diploma|libero/.test(d)) {
        mode = "OPEN";
        modeConf = "LOW";
        modeSnippet = uniModalita[1];
      }
    }
  }

  const seatsText =
    [
      windowFor(windows, ["posti", "seats", "ammissione", "admission"]),
      text,
    ]
      .filter(Boolean)
      .join("\n") || text;

  let nonEuSeats: CallField<number> | null = null;
  let euSeats: CallField<number> | null = null;
  let totalSeats: CallField<number> | null = null;
  const seatPatterns = [
    /(\d{1,3})\s*(?:posti|seats|places)\s+for\s+(?:non[\s-]?EU|extra[\s-]?UE|international)/i,
    /(?:non[\s-]?EU|extra[\s-]?UE|international|stranieri|studenti\s+stranieri|cittadini\s+(?:extra[\s-]?UE|stranieri))[^.\n]{0,60}?(\d{1,3})\s*(?:posti|seats|places)/i,
    /(?:n\.|nr\.|n°)?\s*(\d{1,3})\s*(?:posti|seats)?\s*(?:riservati\s+)?(?:a\s+)?(?:studenti|candidati)?\s*(?:extra[\s-]?UE|non[\s-]?EU)/i,
    /(\d{1,3})\s*(?:posti|seats|places)[^.\n+]{0,40}?(?:non[\s-]?EU|extra[\s-]?UE|international|stranieri|riservati)/i,
    /posti\s+riservati[^.\n]{0,40}?(\d{1,3})/i,
    /(?:available\s+)?(?:seats|places|posti)\s*[:\-]\s*(\d{1,3})\b/i,
  ];
  for (const re of seatPatterns) {
    const seat = seatsText.match(re);
    if (seat) {
      nonEuSeats = {
        value: Number(seat[1]),
        confidence: "HIGH",
        snippet: seat[0].slice(0, 120),
      };
      break;
    }
  }

  const euPatterns = [
    /(\d{1,3})\s*(?:posti|seats|places)\s+for\s+(?:EU|EU-assimilated|comunitari)(?!\s*non)/i,
    /(?:comunitari|cittadini\s+(?<!extra-)(?<!non-)\b(?:UE|EU)\b)[^.\n]{0,60}?(\d{1,4})\s*(?:posti|seats|places)/i,
    /(\d{1,4})\s*(?:posti|seats|places)[^.\n+]{0,40}?(?:comunitari|(?<!extra-)(?<!non-)\b(?:UE|EU)\b)(?!\s*-?\s*assimilat)/i,
  ];
  for (const re of euPatterns) {
    const seat = seatsText.match(re);
    if (seat) {
      euSeats = { value: Number(seat[1]), confidence: "HIGH", snippet: seat[0].slice(0, 120) };
      break;
    }
  }
  const total = seatsText.match(
    /(?:posti\s+complessivi|total\s+seats|posti\s+totali|numero\s+complessivo)[^.\n]{0,40}?(\d{1,4})\b|\b(\d{1,4})\s*(?:posti|seats|places)\s*(?:complessivi|totali|total)/i
  );
  if (total) {
    totalSeats = {
      value: Number(total[1] || total[2]),
      confidence: "HIGH",
      snippet: total[0].slice(0, 120),
    };
  }

  return {
    accessMode: { value: mode, confidence: modeConf, snippet: modeSnippet },
    euSeats,
    nonEuSeats,
    totalSeats,
  };
}

/** Parse EU / non-EU seat counts from HTML table rows when plain-text regex misses them. */
function extractTableSeatsFromHtml(html: string): {
  euSeats: CallField<number> | null;
  nonEuSeats: CallField<number> | null;
  totalSeats: CallField<number> | null;
} {
  let euSeats: CallField<number> | null = null;
  let nonEuSeats: CallField<number> | null = null;
  let totalSeats: CallField<number> | null = null;
  const rows = html.match(/<tr[\s\S]*?<\/tr>/gi) || [];
  for (const row of rows) {
    const plain = row.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    if (!/posti|seats|places/i.test(plain)) continue;
    const numMatch = plain.match(/(\d{1,4})/);
    if (!numMatch) continue;
    const value = Number(numMatch[1]);
    if (/(?:non[\s-]?EU|extra[\s-]?UE|international|stranieri)/i.test(plain)) {
      nonEuSeats = { value, confidence: "HIGH", snippet: plain.slice(0, 120) };
    } else if (/(?:comunitari|cittadini\s+UE|\bEU\b(?!\s*non))/i.test(plain)) {
      euSeats = { value, confidence: "HIGH", snippet: plain.slice(0, 120) };
    } else if (/(?:totali|complessivi|total)/i.test(plain)) {
      totalSeats = { value, confidence: "HIGH", snippet: plain.slice(0, 120) };
    }
  }
  return { euSeats, nonEuSeats, totalSeats };
}

function extractPublicPrivate(text: string): "PUBLIC" | "PRIVATE" | "UNKNOWN" {
  return inferPublicPrivateFromDocumentText(text);
}

function extractSectionDeadlines(
  text: string,
  windows: Map<string, string>
): Array<CallField<string>> {
  const deadlineText =
    windowFor(windows, ["scadenze", "scadenza", "deadline", "deadlines", "ammissione"]) ||
    text;
  const deadlineCue =
    /scadenza|deadline|application\s+deadline|termine|data\s+di\s+scadenza|non[\s-]?eu|extra[\s-]?ue|international/i;
  const lines = linesOf(deadlineText);
  const out: Array<CallField<string>> = [];
  const seen = new Set<string>();

  for (const line of lines) {
    if (!deadlineCue.test(line)) continue;
    const dates = extractDateTokens(line);
    for (const d of dates) {
      if (seen.has(d)) continue;
      seen.add(d);
      const high =
        /scadenza|deadline|application\s+deadline/i.test(line) &&
        /non[\s-]?eu|extra[\s-]?ue|international/i.test(line);
      out.push({
        value: d,
        confidence: high ? "HIGH" : "MEDIUM",
        snippet: line.slice(0, 160),
      });
    }
  }

  if (out.length === 0) {
    for (const d of extractDateTokens(deadlineText).slice(0, 4)) {
      if (seen.has(d)) continue;
      seen.add(d);
      out.push({ value: d, confidence: "LOW", snippet: d });
    }
  }

  return out.slice(0, 8);
}

function extractSectionTuition(
  text: string,
  windows: Map<string, string>
): {
  tuitionMin: CallField<number> | null;
  tuitionMax: CallField<number> | null;
  tuitionFixed: CallField<number> | null;
  incomeBased: boolean;
  tuitionScope: "programme" | "university-wide" | null;
} {
  const incomeBased =
    /ISEE|income[\s-]?based|in\s+base\s+al\s+reddito|contribuzione\s+studentesca|contributo\s+onnicomprensivo/i.test(
      text
    );
  const universityWide =
    /(?:per\s+tutti\s+gli\s+studenti|tutti\s+gli\s+iscritti|university[\s-]?wide|tasse\s+(?:di\s+)?ateneo|contribuzione\s+studentesca\s+di\s+ateneo|fees\s+apply\s+to\s+all\s+students|tuition\s+fees\s+and\s+exemptions|tasse\s+universitarie)/i.test(
      text
    );
  const tuitionScope: "programme" | "university-wide" | null = universityWide
    ? "university-wide"
    : null;
  const tuitionWindow = windowFor(windows, [
    "tasse",
    "contribuzione",
    "tuition",
    "fees",
    "amounts",
  ]);
  const searchIn = tuitionWindow || text;

  const range = extractDaARange(searchIn);
  if (range && range.min >= 0 && range.max >= range.min) {
    const conf: FieldConfidence = tuitionWindow ? "HIGH" : "MEDIUM";
    return {
      tuitionMin: { value: range.min, confidence: conf, snippet: range.snippet },
      tuitionMax: { value: range.max, confidence: conf, snippet: range.snippet },
      tuitionFixed:
        range.min === range.max
          ? { value: range.min, confidence: conf, snippet: range.snippet }
          : null,
      incomeBased,
      tuitionScope: tuitionScope ?? (tuitionWindow ? "programme" : null),
    };
  }

  // One-sided bound is enough — do not require both min and max
  const single = extractSingleTuitionBound(searchIn);
  if (single) {
    const conf: FieldConfidence = tuitionWindow ? "HIGH" : "MEDIUM";
    return {
      tuitionMin:
        single.min != null
          ? { value: single.min, confidence: conf, snippet: single.snippet }
          : null,
      tuitionMax:
        single.max != null
          ? { value: single.max, confidence: conf, snippet: single.snippet }
          : null,
      tuitionFixed: null,
      incomeBased,
      tuitionScope: tuitionScope ?? (tuitionWindow ? "programme" : null),
    };
  }

  const tuitionCue =
    /tuition|tasse|contribuzione|annual\s+fee|university\s+fee|fee\s+for\s+international/i;
  const lines = linesOf(searchIn);
  let sectionAmounts: number[] = [];
  let snippet = "";

  for (const line of lines) {
    if (!tuitionCue.test(line) && !tuitionWindow) continue;
    if (tuitionWindow || tuitionCue.test(line)) {
      // Skip stamp duty / marca da bollo noise
      if (/bollo|stamp\s*duty|application\s+fee|tassa\s+di\s+iscrizione\s+di\s+\d{1,3}\s*€/i.test(line) &&
          !/tuition|contribuzione|annual/i.test(line)) {
        continue;
      }
      const amounts = extractEuroAmounts(line);
      if (amounts.length) {
        sectionAmounts.push(...amounts);
        if (!snippet) snippet = line.slice(0, 160);
      }
    }
  }

  if (sectionAmounts.length === 0 && tuitionWindow) {
    sectionAmounts = extractEuroAmounts(tuitionWindow).filter((n) => n >= 100);
    if (!snippet) snippet = tuitionWindow.slice(0, 160);
  }

  sectionAmounts = [...new Set(sectionAmounts)].sort((a, b) => a - b);
  if (sectionAmounts.length === 0) {
    return {
      tuitionMin: null,
      tuitionMax: null,
      tuitionFixed: null,
      incomeBased,
      tuitionScope,
    };
  }

  const conf: FieldConfidence = tuitionWindow || snippet ? "HIGH" : "MEDIUM";
  const scope = tuitionScope ?? (tuitionWindow ? "programme" : null);
  if (sectionAmounts.length === 1) {
    return {
      tuitionMin: { value: sectionAmounts[0], confidence: conf, snippet },
      tuitionMax: { value: sectionAmounts[0], confidence: conf, snippet },
      tuitionFixed: { value: sectionAmounts[0], confidence: conf, snippet },
      incomeBased,
      tuitionScope: scope,
    };
  }
  return {
    tuitionMin: { value: sectionAmounts[0], confidence: conf, snippet },
    tuitionMax: {
      value: sectionAmounts[sectionAmounts.length - 1],
      confidence: conf,
      snippet,
    },
    tuitionFixed: null,
    incomeBased,
    tuitionScope: scope,
  };
}

function extractLanguages(text: string): string[] {
  const languages: string[] = [];
  if (
    /taught in english|english-taught|lingua inglese|language:\s*english|in\s+english|erogato\s+in\s+inglese|corso\s+in\s+lingua\s+inglese/i.test(
      text
    )
  ) {
    languages.push("English");
  }
  if (
    /taught in italian|lingua italiana|language:\s*italian|in\s+italian|erogato\s+in\s+italiano|corso\s+in\s+lingua\s+italiana/i.test(
      text
    )
  ) {
    languages.push("Italian");
  }
  return languages;
}

function deriveQuality(
  compactLen: number,
  hasSignal: boolean
): CallTextParseQuality {
  if (compactLen < 40) return "EMPTY";
  if (compactLen < 80 || !hasSignal) return "LOW";
  return "OK";
}

/** Score how many useful dossier fields a parse filled (for candidate pick). */
export function fieldCoverageScore(parsed: CallTextParse): number {
  let s = 0;
  if (parsed.tuitionMin || parsed.tuitionMax || parsed.tuitionFixed) s += 3;
  if (parsed.deadlines.length > 0) s += 2;
  if (parsed.accessMode.value !== "UNKNOWN") s += 2;
  if (parsed.quotaRows.length > 0 || parsed.nonEuSeats) s += 2;
  if (parsed.exams.length > 0) s += 2;
  if (parsed.languageLevel) s += 1;
  if (parsed.careerOutcomes) s += 1;
  if (parsed.quality === "OK") s += 1;
  return s;
}

/**
 * Section-aware parse of admission-call / programme page text (HTML-stripped or PDF text).
 */
export function parseCallText(
  body: string,
  url: string,
  options?: { academicYear?: string }
): CallTextParse {
  let raw = body;
  if (
    raw.startsWith("PDF_EXTRACTION_") ||
    raw.startsWith("FETCH_FAILED") ||
    raw.startsWith("FETCH_ERROR")
  ) {
    return emptyParse(url, options?.academicYear, "EMPTY");
  }

  if (raw.startsWith("PDF_OCR\n")) {
    raw = raw.slice("PDF_OCR\n".length);
  }

  const looksHtml = /<html|<body|<p[\s>]|<div[\s>]/i.test(raw.slice(0, 2000));
  let text = looksHtml ? stripHtml(raw) : raw.replace(/\s+/g, " ").trim();
  // SPA / token shells: keep access cues from embedded catalogue JSON, demote length.
  const spaShell =
    /theme_token|dl_start pushed|var\s+Language\s*=|jQuery\.noConflict/i.test(
      text.slice(0, 800)
    ) && text.replace(/\s+/g, "").length < 400;
  if (spaShell) {
    const uniBits = raw.match(
      /"modalitaAccesso"\s*:\s*\{[^}]{0,200}?"descrizione"\s*:\s*"[^"]+"/gi
    );
    if (uniBits?.length) {
      text = `${text} ${uniBits.join(" ")}`.replace(/\s+/g, " ").trim();
    }
  }
  let compactLen = text.replace(/\s+/g, "").length;
  if (spaShell) compactLen = Math.min(compactLen, 50);

  const windows = headingWindows(text);
  const languages = extractLanguages(text);
  const languageLevel = extractCefr(text);
  const tuition = extractSectionTuition(text, windows);
  const deadlines = extractSectionDeadlines(text, windows);
  const access = extractAccess(text, windows);
  const quotaRows = extractScopedQuotaRows(raw);
  const abroadQuota = quotaRows.find(
    (row) => row.category === "NON_EU_RESIDENT_ABROAD"
  );
  const euQuota = quotaRows.find((row) => row.category === "EU_CITIZEN");
  if (abroadQuota) {
    access.nonEuSeats = {
      value: abroadQuota.places,
      confidence: abroadQuota.confidence,
      snippet: abroadQuota.snippet,
    };
  }
  if (euQuota) {
    access.euSeats = {
      value: euQuota.places,
      confidence: euQuota.confidence,
      snippet: euQuota.snippet,
    };
  }
  if (looksHtml) {
    const tableSeats = extractTableSeatsFromHtml(raw);
    if (!access.euSeats && tableSeats.euSeats) access.euSeats = tableSeats.euSeats;
    if (!access.nonEuSeats && tableSeats.nonEuSeats) {
      access.nonEuSeats = tableSeats.nonEuSeats;
    }
    if (!access.totalSeats && tableSeats.totalSeats) {
      access.totalSeats = tableSeats.totalSeats;
    }
  }
  const admissionText = windowFor(windows, [
    "ammissione",
    "admission",
    "requisiti",
    "requirements",
    "prove",
  ]);
  let {
    exams,
    alternatives,
    confidence: examsConfidence,
    admissionGate,
    evaluationOnly,
  } = extractExams(admissionText || text);
  // Heading windows can end before a later "SAT or TOLC" line. Fall back to
  // full text only when the relevant sections yielded no admission exam.
  if (exams.length === 0 && admissionText && admissionText !== text) {
    ({ exams, alternatives, confidence: examsConfidence, admissionGate, evaluationOnly } =
      extractExams(text));
  }
  const careerOutcomes = extractCareer(text, windows);
  const publicPrivate = extractPublicPrivate(text);
  const mentionsTuition = /tuition|tasse|contribuzione/i.test(text);
  const mentionsDeadline = /deadline|scadenza/i.test(text);

  const hasSignal =
    languages.length > 0 ||
    !!languageLevel ||
    !!tuition.tuitionMin ||
    !!tuition.tuitionMax ||
    !!tuition.tuitionFixed ||
    deadlines.length > 0 ||
    access.accessMode.value !== "UNKNOWN" ||
    exams.length > 0 ||
    !!careerOutcomes;

  const admissionRegime = inferAdmissionRegime({
    sourceUrl: url,
    sourceType: "PROGRAMME_PAGE",
    access: access.accessMode.value,
    accessSnippet: access.accessMode.snippet,
    accessConfidence: access.accessMode.confidence,
    admissionGate,
    evaluationOnly,
    exams: alternatives.length >= 2 ? alternatives : exams,
    examsSnippet: (alternatives[0] || exams[0])?.name ?? null,
    examsConfidence,
    languageRequirement: languageLevel?.value ?? null,
    languageSnippet: languageLevel?.snippet ?? null,
    languageConfidence: languageLevel?.confidence,
    euSeats: access.euSeats?.value ?? null,
    nonEuSeats: access.nonEuSeats?.value ?? null,
    totalSeats: access.totalSeats?.value ?? null,
    seatsSnippet:
      access.euSeats?.snippet ?? access.nonEuSeats?.snippet ?? access.totalSeats?.snippet ?? null,
    seatsConfidence:
      access.euSeats?.confidence ?? access.nonEuSeats?.confidence ?? access.totalSeats?.confidence,
    ownership: publicPrivate,
  });

  return {
    url,
    academicYear: options?.academicYear,
    languages,
    languageLevel,
    tuitionMin: tuition.tuitionMin,
    tuitionMax: tuition.tuitionMax,
    tuitionFixed: tuition.tuitionFixed,
    incomeBased: tuition.incomeBased,
    tuitionScope: tuition.tuitionScope,
    deadlines,
    accessMode:
      admissionRegime.access.value !== "UNKNOWN"
        ? {
            value: admissionRegime.access.value,
            confidence: admissionRegime.access.confidence,
            snippet: admissionRegime.access.snippet ?? access.accessMode.snippet,
          }
        : access.accessMode,
    euSeats: access.euSeats,
    nonEuSeats: access.nonEuSeats,
    totalSeats: access.totalSeats,
    quotaRows,
    exams,
    examAlternatives: alternatives,
    examsConfidence,
    admissionGate,
    evaluationOnly,
    admissionRegime,
    careerOutcomes,
    publicPrivate,
    mentionsTuition,
    mentionsDeadline,
    quality: deriveQuality(compactLen, hasSignal),
  };
}

function emptyParse(
  url: string,
  academicYear: string | undefined,
  quality: CallTextParseQuality
): CallTextParse {
  return {
    url,
    academicYear,
    languages: [],
    languageLevel: null,
    tuitionMin: null,
    tuitionMax: null,
    tuitionFixed: null,
    incomeBased: false,
    tuitionScope: null,
    deadlines: [],
    accessMode: { value: "UNKNOWN", confidence: "LOW" },
    euSeats: null,
    nonEuSeats: null,
    totalSeats: null,
    quotaRows: [],
    exams: [],
    examAlternatives: [],
    examsConfidence: "LOW",
    admissionGate: false,
    evaluationOnly: false,
    admissionRegime: inferAdmissionRegime({ sourceUrl: url }),
    careerOutcomes: null,
    publicPrivate: "UNKNOWN",
    mentionsTuition: false,
    mentionsDeadline: false,
    quality,
  };
}

/** Flatten to legacy ProgrammePageParse-compatible shape for callers. */
export function callParseToLegacy(parsed: CallTextParse) {
  return {
    url: parsed.url,
    languages: parsed.languages,
    languageLevel: parsed.languageLevel?.value ?? null,
    tuitionMin: parsed.tuitionMin?.value ?? null,
    tuitionMax: parsed.tuitionMax?.value ?? null,
    deadlines: parsed.deadlines.map((d) => d.value),
    accessMode: parsed.accessMode.value,
    euSeats: parsed.euSeats?.value ?? null,
    nonEuSeats: parsed.nonEuSeats?.value ?? null,
    totalSeats: parsed.totalSeats?.value ?? null,
    exams: parsed.exams,
    examAlternatives: parsed.examAlternatives,
    careerOutcomes: parsed.careerOutcomes?.value ?? null,
    publicPrivate: parsed.publicPrivate,
    mentionsTuition: parsed.mentionsTuition,
    mentionsDeadline: parsed.mentionsDeadline,
    quality: parsed.quality,
  };
}
