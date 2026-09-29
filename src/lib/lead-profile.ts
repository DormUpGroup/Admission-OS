import { isBotCommandBody } from "@/lib/telegram-conversation-kind";

export const LEAD_PROFILE_FACTS: Array<{ key: string; label: string }> = [
  { key: "studyLevel", label: "Уровень" },
  { key: "targetField", label: "Направление" },
  { key: "cities", label: "Города" },
  { key: "desiredIntake", label: "Набор" },
  { key: "educationLevel", label: "Образование" },
  { key: "citizenship", label: "Гражданство" },
  { key: "passport", label: "Паспорт" },
  { key: "diploma", label: "Дипломы" },
  { key: "apostilleTranslation", label: "Апостиль и перевод" },
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
  { pattern: /физик/iu, label: "Физика" },
  { pattern: /изобразительн/iu, label: "Изобразительное искусство" },
  { pattern: /(^|[^\p{L}])it([^\p{L}]|$)|информатик|программист/iu, label: "IT" },
];

/** Facts the bot must have before it offers a consultation. */
export const CONSULTATION_FACT_KEYS = [
  "citizenship",
  "passport",
  "diploma",
  "apostilleTranslation",
] as const;

/** A stored phrase that still leaves the fact unanswered. */
export function factIsKnown(key: string, value: string | null | undefined): boolean {
  const text = value?.trim() ?? "";
  if (!text) return false;
  if (key === "apostilleTranslation" && /не назван|не уточн|неизвест/iu.test(text)) return false;
  return true;
}

export function consultationGate(rows: LeadFactRow[]): { ready: boolean; missing: string[] } {
  const byKey = new Map(rows.map((row) => [row.key, row.value]));
  const missing = CONSULTATION_FACT_KEYS.filter((key) => !factIsKnown(key, byKey.get(key)));
  return { ready: missing.length === 0, missing: [...missing] };
}

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
  if (/магистратур|магистр|мастер/iu.test(text)) return "Магистратура";
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
  places: string[];
  citizenship: string | null;
  passport: string | null;
  diploma: string | null;
  apostilleTranslation: string | null;
  remote: boolean;
  intake: string | null;
  education: string | null;
  exams: string[];
  level: string | null;
  examWhen: string | null;
  languageTopic: boolean;
  languageFree: string | null;
  budget: string[];
};

function emptyDraft(): Draft {
  return {
    studyLevel: null,
    fields: [],
    places: [],
    citizenship: null,
    passport: null,
    diploma: null,
    apostilleTranslation: null,
    remote: false,
    intake: null,
    education: null,
    exams: [],
    level: null,
    examWhen: null,
    languageTopic: false,
    languageFree: null,
    budget: [],
  };
}

function clipAnswer(text: string): string | null {
  const raw = text.trim();
  if (!raw || raw.includes("?") || raw.length > 120) return null;
  const answer = raw.replace(/[.!?…]+$/g, "").trim();
  return answer || null;
}

function isYesBlob(text: string): boolean {
  const normalized = text
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/[^\p{L}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!normalized || normalized.length > 48 || /^(нет|не)\b/u.test(normalized)) return false;
  return /^(есть|да|ага|все|имеется|конечно|давайте|давай)(\s+(есть|да|ага|все|имеется|конечно|давайте|давай))*$/u.test(
    normalized,
  );
}

function isMetaReply(text: string): boolean {
  return /уже\s+(говорил|говорила|сказал|сказала|писал|писала|отвечал|отвечала)|я\s+же/iu.test(text);
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

  for (const place of PLACES) {
    if (place.pattern.test(text)) pushUnique(draft.places, place.label);
  }

  const citizenship = text.match(/гражданств[ао]?\s+([^\n,.!]{2,40})/iu);
  if (citizenship?.[1]) draft.citizenship = citizenship[1].trim();

  if (/^(есть|да|ага|нет)[.!?…\s]*$/iu.test(text) && /паспорт/iu.test(previousOutbound)) {
    draft.passport = /нет/iu.test(text) ? "нет" : "есть";
  } else if (/паспорт/iu.test(text) && /есть|на руках|имеется/iu.test(text)) {
    draft.passport = "есть";
  } else if (/паспорт/iu.test(text) && /нет/iu.test(text)) {
    draft.passport = "нет";
  }

  if (/диплом|аттестат/iu.test(text) && /есть|на руках|имеется/iu.test(text)) {
    draft.diploma = "есть";
  } else if (/диплом|аттестат/iu.test(text) && /нет/iu.test(text)) {
    draft.diploma = "нет";
  }

  if (/апостил/iu.test(text)) {
    draft.apostilleTranslation = /перевед/iu.test(text)
      ? "апостиль и перевод есть"
      : "апостиль есть, перевод не назван";
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
  if (/^(английск\p{L}*|итальянск\p{L}*)[.!?…\s]*$/iu.test(text)) {
    draft.languageFree = /итальян/iu.test(text) ? "итальянский" : "английский";
  }

  const answer = clipAnswer(text);
  if (/гражданств/iu.test(previousOutbound) && answer && !isMetaReply(answer) && !isYesBlob(answer)) {
    draft.citizenship = answer;
  }

  if (/перевод/iu.test(previousOutbound) && isYesBlob(text)) {
    const apostilleAlreadyKnown =
      /апостил/iu.test(previousOutbound) || /апостиль есть/iu.test(draft.apostilleTranslation ?? "");
    draft.apostilleTranslation = apostilleAlreadyKnown
      ? "апостиль и перевод есть"
      : "перевод есть, апостиль не назван";
  } else if (/перевод/iu.test(previousOutbound) && /^нет\b/iu.test(text)) {
    draft.apostilleTranslation = "перевода нет";
  }

  if (
    /сфер|направлен|специальност/iu.test(previousOutbound) &&
    draft.fields.length === 0 &&
    answer &&
    !isYesBlob(answer) &&
    !isMetaReply(answer) &&
    !studyLevelFrom(answer) &&
    !intakeFrom(answer)
  ) {
    pushUnique(draft.fields, answer);
  }

  if (/сумм|бюджет/iu.test(previousOutbound) && draft.budget.length === 0 && answer && !isYesBlob(answer)) {
    pushUnique(draft.budget, answer);
  }
}

function languageLine(draft: Draft): string | null {
  const parts = [...draft.exams];
  if (draft.level) parts.push(draft.level);
  if (draft.examWhen) parts.push(draft.examWhen);
  if (draft.languageFree) parts.push(draft.languageFree);
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
  const cities = citiesLine(draft);
  if (cities) facts.set("cities", cities);
  if (draft.intake) facts.set("desiredIntake", draft.intake);
  if (draft.education) facts.set("educationLevel", draft.education);
  const language = languageLine(draft);
  if (language) facts.set("language", language);
  if (draft.budget.length > 0) facts.set("budget", draft.budget.join(", "));
  if (draft.citizenship) facts.set("citizenship", draft.citizenship);
  if (draft.passport) facts.set("passport", draft.passport);
  if (draft.diploma) facts.set("diploma", draft.diploma);
  if (draft.apostilleTranslation) facts.set("apostilleTranslation", draft.apostilleTranslation);
  return facts;
}

/** Saved qualification, with empty fields filled from the chat. Saved values win. */
export function qualificationWithChatFacts(
  qualificationJson: unknown,
  messages: ChatTurn[],
): Record<string, unknown> {
  const merged: Record<string, unknown> = { ...asRecord(qualificationJson) };
  for (const row of buildLeadCard({ qualificationJson, messages })) {
    if (!scalarText(merged[row.key])) merged[row.key] = row.value;
  }
  return merged;
}

/** Facts safe to write onto the lead: known, still empty, and in the allowed list. */
export function chatFactsToSave(
  qualificationJson: unknown,
  messages: ChatTurn[],
  fields: readonly string[],
): Record<string, string> {
  const saved = asRecord(qualificationJson);
  const allowed = new Set(fields);
  const patch: Record<string, string> = {};
  for (const row of buildLeadCard({ qualificationJson, messages })) {
    if (!allowed.has(row.key) || scalarText(saved[row.key]) || !factIsKnown(row.key, row.value)) continue;
    patch[row.key] = row.value;
  }
  return patch;
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
