import { isBotCommandBody } from "@/lib/telegram-conversation-kind";

export const LEAD_PROFILE_FACTS: Array<{ key: string; label: string }> = [
  { key: "educationLevel", label: "Образование" },
  { key: "studyLevel", label: "Уровень" },
  { key: "targetField", label: "Направление" },
  { key: "desiredIntake", label: "Набор" },
  { key: "preferredCountry", label: "Страна" },
  { key: "budget", label: "Бюджет" },
];

const FACT_LABELS = new Map(LEAD_PROFILE_FACTS.map((fact) => [fact.key, fact.label]));

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

export type LeadFactRow = { key: string; label: string; value: string };

/** Saved qualification fields, known ones first, then anything else the chat stored. */
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

/** A turn that actually says something about the person. Bot commands are not profile facts. */
export function isLeadProfileMessage(body: string | null | undefined): boolean {
  const text = body?.trim();
  if (!text) return false;
  return !isBotCommandBody(text);
}
