import {
  QUESTIONNAIRE_DIRECTION_MIUR,
  type MiurClasseByLevel,
} from "@/lib/program-directions";

export type { MiurClasseByLevel };

export const FIELD_TAXONOMY = [
  "Business",
  "Economics",
  "Finance",
  "Management",
  "Computer Science",
  "AI",
  "Engineering",
  "Architecture",
  "Medicine",
  "Biology",
  "Psychology",
  "Political Science",
  "International Relations",
  "Tourism",
  "Design",
  "Law",
  "Physics",
  "Mathematics",
  "Chemistry",
  "Languages",
  "Education",
] as const;

export type FieldTag = (typeof FIELD_TAXONOMY)[number];

const DIRECTION_ALIASES: Array<{ pattern: RegExp; tags: FieldTag[] }> = [
  { pattern: /финанс|finance/i, tags: ["Finance", "Economics"] },
  { pattern: /экономич|economics/i, tags: ["Economics"] },
  { pattern: /бизнес|business|управлен|management|digital management/i, tags: ["Business", "Management"] },
  {
    pattern:
      /компьютер|информатик|informatics|computer|software|computing|cs\b|it безопас|digital technolog|информационно-издатель/i,
    tags: ["Computer Science"],
  },
  {
    pattern: /\bai\b|artificial|искусствен|machine learning|data science/i,
    tags: ["AI", "Computer Science"],
  },
  {
    pattern:
      /инженер|engineer|строительств|автоматизац|электротех|телекоммуникац|военно-морск|инжиниринг|материаловеден/i,
    tags: ["Engineering"],
  },
  { pattern: /архитектур|architect|градостроительн|ландшафтн/i, tags: ["Architecture"] },
  { pattern: /медицин|medicine|хирург|стоматолог|ветеринар|фармацевт/i, tags: ["Medicine"] },
  { pattern: /биолог|biotech|биотех|сельскохозяйственн|пищев|лесовод|питани/i, tags: ["Biology"] },
  { pattern: /психолог|когнитивн/i, tags: ["Psychology"] },
  { pattern: /политическ|political|государственн.*управл/i, tags: ["Political Science"] },
  { pattern: /международн|international relations/i, tags: ["International Relations"] },
  { pattern: /туризм|touris/i, tags: ["Tourism"] },
  { pattern: /дизайн|design|мультимедиа|развлекательн/i, tags: ["Design"] },
  { pattern: /право|law/i, tags: ["Law"] },
  { pattern: /физик|physics|вселенн|геологич|геолог/i, tags: ["Physics"] },
  { pattern: /математик/i, tags: ["Mathematics"] },
  { pattern: /хими/i, tags: ["Chemistry"] },
  {
    pattern:
      /язык|филолог|лингвист|антропологи|археолог|архивн|библиотек|музыковед|религи/i,
    tags: ["Languages"],
  },
  { pattern: /образован|education|педагог/i, tags: ["Education"] },
  { pattern: /спортивн|двигательн|моторн.*деятельн/i, tags: ["Education"] },
  { pattern: /природ|окружающ.*сред|экологическ.*наук/i, tags: ["Biology"] },
  { pattern: /коммуникац|рекламн/i, tags: ["Business"] },
];

export function tagsFromText(value: string | null | undefined): FieldTag[] {
  if (!value) return [];
  const tags = new Set<FieldTag>();
  for (const { pattern, tags: next } of DIRECTION_ALIASES) {
    if (pattern.test(value)) next.forEach((t) => tags.add(t));
  }
  return [...tags];
}

export function tagsFromList(values: string[]): FieldTag[] {
  const tags = new Set<FieldTag>();
  for (const v of values) tagsFromText(v).forEach((t) => tags.add(t));
  return [...tags];
}

export const CITY_TO_REGION: Record<string, string> = {
  Bologna: "Emilia-Romagna",
  Ferrara: "Emilia-Romagna",
  Modena: "Emilia-Romagna",
  Parma: "Emilia-Romagna",
  "Forlì": "Emilia-Romagna",
  Ravenna: "Emilia-Romagna",
  Rimini: "Emilia-Romagna",
  Turin: "Piedmont",
  Torino: "Piedmont",
  Venice: "Veneto",
  Venezia: "Veneto",
  Padova: "Veneto",
  Padua: "Veneto",
  Verona: "Veneto",
  Milano: "Lombardy",
  Milan: "Lombardy",
  Bergamo: "Lombardy",
  Brescia: "Lombardy",
  Pavia: "Lombardy",
  "Varese/Como": "Lombardy",
  Roma: "Lazio",
  Rome: "Lazio",
  Viterbo: "Lazio",
  Cassino: "Lazio",
  Pisa: "Tuscany",
  Siena: "Tuscany",
  Firenze: "Tuscany",
  Florence: "Tuscany",
  Trento: "Trentino-Alto Adige",
  Bolzano: "Trentino-Alto Adige",
  Napoli: "Campania",
  Genova: "Liguria",
  Bari: "Apulia",
  Palermo: "Sicily",
  Catania: "Sicily",
  Cagliari: "Sardinia",
  Trieste: "Friuli-Venezia Giulia",
  Perugia: "Umbria",
  Ancona: "Marche",
};

export function regionForCity(city: string | null | undefined): string | null {
  if (!city) return null;
  const direct = CITY_TO_REGION[city];
  if (direct) return direct;
  const key = Object.keys(CITY_TO_REGION).find(
    (k) => k.toLowerCase() === city.toLowerCase()
  );
  return key ? CITY_TO_REGION[key] : null;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Parse a known Italian city out of a Universitaly university name. */
export function cityFromUniversityName(
  name: string | null | undefined
): string | null {
  if (!name?.trim()) return null;
  const keys = Object.keys(CITY_TO_REGION)
    .filter((k) => !k.includes("/"))
    .sort((a, b) => b.length - a.length);
  for (const city of keys) {
    const re = new RegExp(`\\b${escapeRegExp(city)}\\b`, "i");
    if (re.test(name)) return city;
  }
  return null;
}

/** Italian province name as used by Universitaly `provincia` filter. */
export const CITY_TO_PROVINCE: Record<string, string> = {
  Bologna: "Bologna",
  Ferrara: "Ferrara",
  Modena: "Modena",
  Parma: "Parma",
  "Forlì": "Forlì-Cesena",
  Ravenna: "Ravenna",
  Rimini: "Rimini",
  Turin: "Torino",
  Torino: "Torino",
  Venice: "Venezia",
  Venezia: "Venezia",
  Padova: "Padova",
  Padua: "Padova",
  Verona: "Verona",
  Milano: "Milano",
  Milan: "Milano",
  Bergamo: "Bergamo",
  Brescia: "Brescia",
  Pavia: "Pavia",
  Roma: "Roma",
  Rome: "Roma",
  Viterbo: "Viterbo",
  Pisa: "Pisa",
  Siena: "Siena",
  Firenze: "Firenze",
  Florence: "Firenze",
  Trento: "Trento",
  Bolzano: "Bolzano",
  Napoli: "Napoli",
  Genova: "Genova",
  Bari: "Bari",
  Palermo: "Palermo",
  Catania: "Catania",
  Cagliari: "Cagliari",
  Trieste: "Trieste",
  Perugia: "Perugia",
  Ancona: "Ancona",
};

export function provinceForCity(city: string | null | undefined): string | null {
  if (!city) return null;
  const direct = CITY_TO_PROVINCE[city];
  if (direct) return direct;
  const key = Object.keys(CITY_TO_PROVINCE).find(
    (k) => k.toLowerCase() === city.toLowerCase()
  );
  return key ? CITY_TO_PROVINCE[key] : null;
}

/**
 * CUN scientific areas used by Universitaly `area` (1–15).
 * Kept for legacy/compat; primary discovery now uses MIUR classi.
 * @see Universitaly cerca-corsi filters
 */
export const FIELD_TAG_TO_CUN_AREA: Partial<Record<FieldTag, string>> = {
  Mathematics: "1",
  Physics: "2",
  Chemistry: "3",
  Biology: "5",
  Medicine: "6",
  "Computer Science": "1",
  AI: "1",
  Engineering: "9",
  Architecture: "8",
  Design: "8",
  Psychology: "11",
  Law: "12",
  Economics: "13",
  Business: "13",
  Finance: "13",
  Management: "13",
  "Political Science": "14",
  "International Relations": "14",
  Tourism: "13",
  Languages: "10",
  Education: "11",
};

/**
 * MIUR classe di laurea codes per FieldTag sphere (fallback when interest is a
 * FieldTag rather than a questionnaire direction label).
 * Same class → programmes of one type regardless of marketing title.
 * Resolved to Universitaly `tipoClasse` ids at search time via lista-classi.
 */
export const FIELD_TAG_MIUR_CLASSI: Partial<Record<FieldTag, MiurClasseByLevel>> = {
    "Computer Science": {
      bachelor: ["L-31", "L-8"],
      master: ["LM-18", "LM-32"],
    },
    AI: {
      bachelor: ["L-31", "L-8"],
      master: ["LM-18", "LM-32"],
    },
    Engineering: {
      bachelor: ["L-8", "L-9", "L-7"],
      master: ["LM-32", "LM-33", "LM-29"],
    },
    Economics: {
      bachelor: ["L-33", "L-18"],
      master: ["LM-56", "LM-77"],
    },
    Finance: {
      bachelor: ["L-33", "L-18"],
      master: ["LM-56", "LM-77"],
    },
    Business: {
      bachelor: ["L-18", "L-33"],
      master: ["LM-77", "LM-56"],
    },
    Management: {
      bachelor: ["L-18", "L-33"],
      master: ["LM-77", "LM-56"],
    },
    Mathematics: {
      bachelor: ["L-35"],
      master: ["LM-40"],
    },
    Physics: {
      bachelor: ["L-30"],
      master: ["LM-17"],
    },
    Chemistry: {
      bachelor: ["L-27"],
      master: ["LM-54"],
    },
    Biology: {
      bachelor: ["L-13"],
      master: ["LM-6"],
    },
    Medicine: {
      bachelor: [],
      master: [],
      singleCycle: ["LM-41"],
    },
    Architecture: {
      bachelor: ["L-17"],
      master: ["LM-4"],
      singleCycle: ["LM-4"],
    },
    Design: {
      bachelor: ["L-4"],
      master: ["LM-12"],
    },
    Psychology: {
      bachelor: ["L-24"],
      master: ["LM-51"],
    },
    Law: {
      bachelor: ["L-14"],
      master: [],
      singleCycle: ["LMG/01"],
    },
    "Political Science": {
      bachelor: ["L-36"],
      master: ["LM-62"],
    },
    "International Relations": {
      bachelor: ["L-36"],
      master: ["LM-52"],
    },
    Tourism: {
      bachelor: ["L-15"],
      master: ["LM-49"],
    },
    Languages: {
      bachelor: ["L-11", "L-12"],
      master: ["LM-37", "LM-38"],
    },
    Education: {
      bachelor: ["L-19"],
      master: ["LM-85"],
    },
  };

/**
 * Synonym keywords for Universitaly `searchText` fallback.
 * Merged when MIUR pool is below UNIVERSITALY_SYNONYM_FALLBACK_MIN_CANDIDATES.
 */
export const FIELD_TAG_SEARCH_SYNONYMS: Partial<Record<FieldTag, string[]>> = {
  "Computer Science": [
    "computer science",
    "informatics",
    "intelligenza artificiale",
    "computer",
  ],
};

/** Per questionnaire direction label — fill later alongside FieldTag synonyms. */
export const DIRECTION_SEARCH_SYNONYMS: Record<string, string[]> = {
  "Компьютерные технологии": [
    "computer science",
    "informatics",
    "intelligenza artificiale",
    "computer",
  ],
  "Компьютерная инженерия": [
    "computer engineering",
    "ingegneria informatica",
    "computer",
  ],
  "IT безопасность": [
    "cybersecurity",
    "computer security",
    "sicurezza informatica",
  ],
};

/** Collect deduped synonym keywords for profile interests (FieldTag and/or RU labels). */
export function synonymsForInterests(tags: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const tag of tags) {
    const fromDirection = DIRECTION_SEARCH_SYNONYMS[tag] ?? [];
    const fromField = FIELD_TAG_SEARCH_SYNONYMS[tag as FieldTag] ?? [];
    for (const s of [...fromDirection, ...fromField]) {
      const key = s.trim().toLowerCase();
      if (!key || seen.has(key)) continue;
      seen.add(key);
      out.push(s.trim());
    }
  }
  return out;
}

/** @deprecated Prefer synonymsForInterests — first synonym per FieldTag if any. */
const FIELD_TAG_SEARCH_TEXT: Partial<Record<FieldTag, string>> = Object.fromEntries(
  Object.entries(FIELD_TAG_SEARCH_SYNONYMS)
    .map(([k, v]) => [k, v?.[0]])
    .filter(([, v]) => Boolean(v))
) as Partial<Record<FieldTag, string>>;

/** Pick primary CUN area from field tags (first mapped tag wins). */
export function fieldTagsToCunArea(tags: string[]): string | undefined {
  for (const tag of tags) {
    const area = FIELD_TAG_TO_CUN_AREA[tag as FieldTag];
    if (area) return area;
  }
  return undefined;
}

/** Free-text keywords for Universitaly `searchText` from first known direction. */
export function fieldTagsToSearchText(tags: string[]): string | undefined {
  for (const tag of tags) {
    const text = FIELD_TAG_SEARCH_TEXT[tag as FieldTag];
    if (text) return text;
  }
  if (tags[0]) return tags[0];
  return undefined;
}

export type ClasseRole = "primary" | "secondary";

export type DirectionSearchSlice = {
  tag: string;
  /** MIUR classe code (L-31) — primary discovery key. */
  classeCode?: string;
  /** First code in the direction level array = primary; rest = secondary. */
  role?: ClasseRole;
  /** Synonym backup only; do not combine with classeCode on same slice. */
  searchText?: string;
  /** Legacy; unused by classe-first discovery. */
  area?: string;
};

export type DirectionSliceOptions = {
  degreeLevel?: string;
  /**
   * @deprecated No longer truncates — page budget is the only hard capacity limit.
   * Kept for call-site compat.
   */
  maxTags?: number;
  /**
   * @deprecated No longer truncates — page budget is the only hard capacity limit.
   */
  maxSlices?: number;
};

function classiForInterest(
  tag: string,
  degreeLevel: string | undefined
): string[] {
  const fromDirection = QUESTIONNAIRE_DIRECTION_MIUR[tag];
  const fromField = FIELD_TAG_MIUR_CLASSI[tag as FieldTag];
  const row = fromDirection ?? fromField;
  if (!row) return [];
  const level = (degreeLevel ?? "BACHELOR").toUpperCase();
  if (level === "MASTER") return row.master;
  if (level === "SINGLE_CYCLE")
    return row.singleCycle?.length
      ? row.singleCycle
      : row.master.length
        ? row.master
        : row.bachelor;
  // Foundation / bachelor: prefer bachelor; fall back to singleCycle for medicine etc.
  if (row.bachelor.length) return row.bachelor;
  return row.singleCycle ?? [];
}

/**
 * Slices for Universitaly discovery: MIUR classi for all selected labels.
 * Prefer exact questionnaire direction labels over FieldTag expansion.
 * Does not silently drop directions — capacity is enforced via page budget.
 * Same classe may appear for multiple directions (API dedupe happens in query plan).
 */
export function fieldTagsToDirectionSlices(
  tags: string[],
  options: DirectionSliceOptions = {}
): DirectionSearchSlice[] {
  const slices: DirectionSearchSlice[] = [];

  const questionnaireLabels = tags.filter((t) => QUESTIONNAIRE_DIRECTION_MIUR[t]);
  const tagsToUse =
    questionnaireLabels.length > 0 ? questionnaireLabels : tags;

  for (const tag of tagsToUse) {
    const codes = classiForInterest(tag, options.degreeLevel);
    codes.forEach((code, index) => {
      slices.push({
        tag,
        classeCode: code.trim(),
        role: index === 0 ? "primary" : "secondary",
      });
    });
  }

  if (slices.length === 0 && tags.length === 0) {
    slices.push({ tag: "" });
  }

  return slices;
}

/** Normalize a direction label for strong-tag matching. */
export function normalizeDirectionLabel(label: string): string {
  return label.trim().toLowerCase().replace(/\s+/g, " ");
}

export const EU_COUNTRIES = new Set(
  [
    "Italy",
    "Italia",
    "Austria",
    "Belgium",
    "Bulgaria",
    "Croatia",
    "Cyprus",
    "Czechia",
    "Czech Republic",
    "Denmark",
    "Estonia",
    "Finland",
    "France",
    "Germany",
    "Greece",
    "Hungary",
    "Ireland",
    "Latvia",
    "Lithuania",
    "Luxembourg",
    "Malta",
    "Netherlands",
    "Poland",
    "Portugal",
    "Romania",
    "Slovakia",
    "Slovenia",
    "Spain",
    "Sweden",
  ].map((c) => c.toLowerCase())
);

export const CEFR_ORDER = ["A1", "A2", "B1", "B2", "C1", "C2"] as const;

export function parseCefr(value: string | null | undefined): string | null {
  if (!value) return null;
  const m = value.toUpperCase().match(/\b(A1|A2|B1|B2|C1|C2)\b/);
  return m ? m[1] : null;
}

export function cefrAtLeast(actual: string, required: string): boolean {
  const a = CEFR_ORDER.indexOf(actual as (typeof CEFR_ORDER)[number]);
  const b = CEFR_ORDER.indexOf(required as (typeof CEFR_ORDER)[number]);
  if (a < 0 || b < 0) return false;
  return a >= b;
}

export function slugify(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80);
}
