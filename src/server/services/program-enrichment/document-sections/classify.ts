import type { SectionType } from "./types";

const TYPE_MARKERS: Record<Exclude<SectionType, "GENERAL">, RegExp> = {
  EXAMS:
    /\b(entrance exam|admission test|test di ammissione|prova (?:di ammissione|in ingresso|d['']ingresso)|verifica delle conoscenze|tolc(?:-[a-z0-9]+)?|cisia|imat|sat\b|act\b|colloquio|interview|portfolio|concorso|ofa)\b/i,
  ADMISSION:
    /\b(requisiti di ammissione|admission requirements?|modalit[aà] di accesso|how to enrol|how to enroll|ammissione|admission|accesso libero|open access|numero programmato|programmed (?:access|number)|immatricol|iscriv|accesso)\b/i,
  LANGUAGE:
    /\b(requisito linguistico|language requirements?|taught in english|erogato in inglese|ielts|toefl|cambridge|cils|celi|cefr|qcer|cef\b|livello [abc][12]|english [abc][12]|italiano [abc][12]|certificazione di inglese|lingua)\b/i,
  SEATS:
    /\b(posti riservati|n\.?\s*\d+\s*posti|posti(?:\s+(?:disponibili|non-eu|extra-ue))?|seats?|places reserved|quota)\b/i,
  DEADLINES:
    /\b(scadenze? domande|application deadlines?|data di scadenza|scadenze?|deadlines?|termin[ei])\b/i,
  TUITION:
    /\b(contributo onnicomprensivo|tassa regionale|contribuzione|tuition|tasse|fees|amounts|isee|€|euro)\b/i,
  DOCUMENTS:
    /\b(documenti richiesti|required documents?|documentation to submit|allegati richiesti|documenti da presentare|documents?)\b/i,
};

const HEADING_BOOST: Record<Exclude<SectionType, "GENERAL">, RegExp> = {
  EXAMS:
    /^(prova|exam|test|tolc|imat|sat|concorso|colloquio|interview|selezione)/i,
  ADMISSION:
    /^(requisiti|ammissione|admission|accesso|enrol|enroll|how to)/i,
  LANGUAGE: /^(lingua|language|english|italiano|ielts|toefl)/i,
  SEATS: /^(posti|seats|quota|places)/i,
  DEADLINES: /^(scadenze?|deadlines?|termin)/i,
  TUITION: /^(tasse|tuition|fees|contribuzione|amounts)/i,
  DOCUMENTS: /^(documenti|documents|allegati)/i,
};

export function classifySectionType(heading: string, text: string): SectionType {
  const headingText = heading.trim();
  const body = `${headingText} ${text}`.trim();
  let best: { type: SectionType; score: number } = { type: "GENERAL", score: 0 };

  (Object.keys(TYPE_MARKERS) as Array<Exclude<SectionType, "GENERAL">>).forEach(
    (type) => {
      let score = 0;
      if (TYPE_MARKERS[type].test(body)) score += 3;
      if (headingText && HEADING_BOOST[type].test(headingText)) score += 4;
      if (headingText && TYPE_MARKERS[type].test(headingText)) score += 3;
      if (score > best.score) best = { type, score };
    }
  );

  return best.score > 0 ? best.type : "GENERAL";
}

const CATEGORY_HINTS: Array<{ scope: string; re: RegExp }> = [
  {
    scope: "NON_EU_RESIDENT_ITALY",
    re: /\b(non-?eu.{0,40}(resident|residing|resid).{0,20}ital|extra-?ue.{0,40}ital)/i,
  },
  {
    scope: "NON_EU_RESIDENT_ABROAD",
    re: /\b(non-?eu(?:\s+country|\s+applicants?|\s+students?)?|extra-?ue|extra ue|stranieri|internazionali|residing abroad|residenti all['']estero)\b/i,
  },
  {
    scope: "EU_EQUIVALENT",
    re: /\b(eu equivalent|equiparati|equivalente.{0,12}ue)\b/i,
  },
  {
    scope: "EU_CITIZEN",
    re: /\b(eu country|eu citizens?|cittadini ue|comunitari|ue\/see|eu\/eea)\b/i,
  },
];

export function detectCategoryHints(heading: string, text: string): string[] {
  const hay = `${heading} ${text}`;
  const found: string[] = [];
  for (const { scope, re } of CATEGORY_HINTS) {
    if (re.test(hay) && !found.includes(scope)) found.push(scope);
  }
  return found;
}

const YEAR_RE = /\b(20\d{2})\s*\/\s*(20\d{2}|\d{2})\b/;

export function detectAcademicYear(
  heading: string,
  text: string,
  fallback?: string | null
): string | null {
  const hay = `${heading} ${text}`;
  const m = hay.match(YEAR_RE);
  if (!m) return fallback ?? null;
  const start = m[1];
  const endRaw = m[2];
  const end = endRaw.length === 2 ? `20${endRaw}` : endRaw;
  return `${start}/${end}`;
}

export function looksLikeHtml(value: string): boolean {
  return /<[a-z][\s\S]*?>/i.test(value) && /<\/[a-z][^>]*>/i.test(value);
}
