import { isBotCommandBody } from "@/lib/telegram-conversation-kind";

export const LEAD_PROFILE_FACTS: Array<{ key: string; label: string }> = [
  { key: "studyLevel", label: "Уровень" },
  { key: "targetField", label: "Направление" },
  { key: "preferredCountry", label: "Страна" },
  { key: "cities", label: "Города" },
  { key: "desiredIntake", label: "Набор" },
  { key: "educationLevel", label: "Образование" },
  { key: "language", label: "Язык" },
  { key: "budget", label: "Бюджет" },
  { key: "documents", label: "Документы" },
];

const FACT_LABELS = new Map(LEAD_PROFILE_FACTS.map((fact) => [fact.key, fact.label]));

const PLACES: Array<{ pattern: RegExp; label: string }> = [
  { pattern: /пьемонт/iu, label: "Пьемонт" },
  { pattern: /турин/iu, label: "Турин" },
  { pattern: /римини/iu, label: "Римини" },
  { pattern: /милан/iu, label: "Милан" },
  { pattern: /болонь/iu, label: "Болонья" },
  { pattern: /флоренц/iu, label: "Флоренция" },
  { pattern: /венеци/iu, label: "Венеция" },
  { pattern: /неапол/iu, label: "Неаполь" },
  { pattern: /рим(?!ини)/iu, label: "Рим" },
];

const COUNTRIES: Array<{ pattern: RegExp; label: string }> = [
  { pattern: /итали/iu, label: "Италия" },
  { pattern: /герман/iu, label: "Германия" },
  { pattern: /франц/iu, label: "Франция" },
  { pattern: /испан/iu, label: "Испания" },
];

const FIELDS: Array<{ pattern: RegExp; label: string }> = [
  { pattern: /international\s+law/iu, label: "International Law" },
  { pattern: /(^|[^\p{L}])право([^\p{L}]|$)/iu, label: "Право" },
  { pattern: /биолог/iu, label: "Биология" },
  { pattern: /бизнес/iu, label: "Бизнес" },
  { pattern: /финанс/iu, label: "Финансы" },
  { pattern: /экономик/iu, label: "Экономика" },
  { pattern: /инженер/iu, label: "Инженерия" },
  { pattern: /медицин/iu, label: "Медицина" },
  { pattern: /архитектур/iu, label: "Архитектура" },
  { pattern: /дизайн/iu, label: "Дизайн" },
  { pattern: /(^|[^\p{L}])it([^\p{L}]|$)|информатик|программист/iu, label: "IT" },
];

export type ChatTurn = {
  direction: string;
  body: string | null;
};

export type LeadFactRow = { key: string; label: string; value: string };

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function scalarText(value: unknown): string | null {
  if (typeof value === "string") {
    const text = value.trim();
    return text || null;
  }
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value === "boolean") return value ? "да" : "нет";
  return null;
}

/** Saved qualification fields, known ones first, then anything else already stored. */
export function readLeadFacts(qualificationJson: unknown): LeadFactRow[] {
  const record = asRecord(qualificationJson);
  const rows: LeadFactRow[] = [];
  const seen = new Set<string>();

  for (const fact of LEAD_PROFILE_FACTS) {
    seen.add(fact.key);
    const value = scalarText(record[fact.key]);
    if (value) rows.push({ key: fact.key, label: fact.label, value });
  }

  for (const [key, raw] of Object.entries(record)) {
    if (seen.has(key)) continue;
    const value = scalarText(raw);
    if (!value) continue;
    rows.push({ key, label: FACT_LABELS.get(key) ?? key, value });
  }

  return rows;
}

function plain(body: string | null | undefined): string {
  return (body ?? "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function intakeFrom(text: string): string | null {
  const match = text.match(/(?:20)?(\d{2})\s*[\/\-–]\s*(?:20)?(\d{2})/);
  if (match) {
    const start = Number(match[1]);
    const end = Number(match[2]);
    if (start >= 20 && start <= 40 && end >= 20 && end <= 40) {
      return `20${String(start).padStart(2, "0")}/${String(end).padStart(2, "0")}`;
    }
  }
  if (/^(?:в\s+)?следующ(?:ий|ем|его)?(?:\s+(?:год|набор))?[.!?…\s]*$/iu.test(text)) {
    return "следующий набор";
  }
  return null;
}

function studyLevelFrom(text: string): string | null {
  if (/магистратур|магистр/iu.test(text)) return "Магистратура";
  if (/бакалавр/iu.test(text)) return "Бакалавриат";
  if (/аспирант|\bphd\b/iu.test(text)) return "Аспирантура";
  if (/foundation|подготовительн/iu.test(text)) return "Подготовительный";
  return null;
}

function educationFrom(text: string): string | null {
  if (/12\s*класс/iu.test(text)) return "12 классов";
  if (/школ/iu.test(text) && /окончил|закончил/iu.test(text)) return "Школа";
  return null;
}

type Draft = {
  studyLevel: string | null;
  fields: string[];
  country: string | null;
  italyFromPlace: boolean;
  places: string[];
  remote: boolean;
  intake: string | null;
  education: string | null;
  exams: string[];
  level: string | null;
  examWhen: string | null;
  languageTopic: boolean;
  budget: string[];
  documents: string[];
};

function emptyDraft(): Draft {
  return {
    studyLevel: null,
    fields: [],
    country: null,
    italyFromPlace: false,
    places: [],
    remote: false,
    intake: null,
    education: null,
    exams: [],
    level: null,
    examWhen: null,
    languageTopic: false,
    budget: [],
    documents: [],
  };
}

function pushUnique(list: string[], value: string) {
  if (!list.includes(value)) list.push(value);
}

function absorb(text: string, previousOutbound: string, draft: Draft) {
  const level = studyLevelFrom(text);
  if (level) draft.studyLevel = level;

  for (const field of FIELDS) {
    if (field.pattern.test(text)) pushUnique(draft.fields, field.label);
  }

  for (const country of COUNTRIES) {
    if (country.pattern.test(text)) draft.country = country.label;
  }

  for (const place of PLACES) {
    if (place.pattern.test(text)) {
      pushUnique(draft.places, place.label);
      draft.italyFromPlace = true;
    }
  }
  if (/удал[её]н/iu.test(text)) draft.remote = true;

  const intake = intakeFrom(text);
  if (intake) draft.intake = intake;

  const education = educationFrom(text);
  if (education) draft.education = education;

  if (/ielts/iu.test(text)) {
    pushUnique(draft.exams, "IELTS");
    draft.languageTopic = true;
  }
  if (/toefl/iu.test(text)) {
    pushUnique(draft.exams, "TOEFL");
    draft.languageTopic = true;
  }
  if (/(^|[^\p{L}\d])(?:b2|б2)([^\p{L}\d]|$)/iu.test(text)) {
    draft.level = "около B2";
    draft.languageTopic = true;
  } else if (/(^|[^\p{L}\d])(?:b1|б1)([^\p{L}\d]|$)/iu.test(text)) {
    draft.level = "около B1";
    draft.languageTopic = true;
  } else if (/(^|[^\p{L}\d])(?:c1|с1)([^\p{L}\d]|$)/iu.test(text)) {
    draft.level = "около C1";
    draft.languageTopic = true;
  }
  if (/декабр/iu.test(text) && (draft.languageTopic || /ielts|toefl|английск/iu.test(text))) {
    draft.examWhen = "сдача в декабре";
    draft.languageTopic = true;
  }

  if (/стипенди/iu.test(text)) pushUnique(draft.budget, "нужна стипендия");
  if (/денег\s+нет|нет\s+денег/iu.test(text)) pushUnique(draft.budget, "денег нет");
  if (/как можно меньше/iu.test(text)) pushUnique(draft.budget, "как можно меньше");
  if (/только\s+обучени/iu.test(text)) pushUnique(draft.budget, "только обучение");

  if (/апостил/iu.test(text)) {
    pushUnique(
      draft.documents,
      /перевед/iu.test(text) ? "апостиль и перевод, на руках" : "апостиль, на руках",
    );
  }

  if (/^(есть|да|ага)[.!?…\s]*$/iu.test(text) && /загран/iu.test(previousOutbound)) {
    pushUnique(draft.documents, "загранпаспорт на руках");
  }
}

function languageLine(draft: Draft): string | null {
  const parts = [...draft.exams];
  if (draft.level) parts.push(draft.level);
  if (draft.examWhen) parts.push(draft.examWhen);
  return parts.length > 0 ? parts.join(", ") : null;
}

function citiesLine(draft: Draft): string | null {
  const places = [...draft.places];
  if (draft.remote) places.push("удалённо");
  return places.length > 0 ? places.join(", ") : null;
}

function extractedFacts(messages: ChatTurn[]): Map<string, string> {
  const draft = emptyDraft();
  let previousOutbound = "";
  for (const message of messages) {
    const text = plain(message.body);
    if (!text || isBotCommandBody(text) || /^ops-check\b/i.test(text)) {
      if (message.direction !== "INBOUND" && text) previousOutbound = text;
      continue;
    }
    if (message.direction !== "INBOUND") {
      previousOutbound = text;
      continue;
    }
    absorb(text, previousOutbound, draft);
  }

  const facts = new Map<string, string>();
  if (draft.studyLevel) facts.set("studyLevel", draft.studyLevel);
  if (draft.fields.length > 0) facts.set("targetField", draft.fields.join(", "));
  const country = draft.country ?? (draft.italyFromPlace ? "Италия" : null);
  if (country) facts.set("preferredCountry", country);
  const cities = citiesLine(draft);
  if (cities) facts.set("cities", cities);
  if (draft.intake) facts.set("desiredIntake", draft.intake);
  if (draft.education) facts.set("educationLevel", draft.education);
  const language = languageLine(draft);
  if (language) facts.set("language", language);
  if (draft.budget.length > 0) facts.set("budget", draft.budget.join(", "));
  if (draft.documents.length > 0) facts.set("documents", draft.documents.join(", "));
  return facts;
}

/**
 * Short lead card. Saved qualification wins. Empty fields are filled from what
 * the person wrote, not from a copy of the chat.
 */
export function buildLeadCard(input: {
  qualificationJson?: unknown;
  messages: ChatTurn[];
}): LeadFactRow[] {
  const saved = new Map(readLeadFacts(input.qualificationJson).map((row) => [row.key, row.value]));
  const extracted = extractedFacts(input.messages);
  const rows: LeadFactRow[] = [];

  for (const fact of LEAD_PROFILE_FACTS) {
    const value = saved.get(fact.key) ?? extracted.get(fact.key);
    if (!value) continue;
    rows.push({ key: fact.key, label: fact.label, value });
    saved.delete(fact.key);
  }

  for (const [key, value] of saved) {
    rows.push({ key, label: FACT_LABELS.get(key) ?? key, value });
  }

  return rows;
}
