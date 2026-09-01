import { normalizeAcademicYear } from "@/server/services/program-matching/compare";

const TECHNICAL_RE =
  /\b(UNKNOWN|NEEDS_REVIEW|PARSER|FIT|MANUAL_VERIFIED|AUTO_MATCHED|ELIGIBLE|LIKELY_ELIGIBLE|NOT_ELIGIBLE|SHORTLISTED|confidence|scoreBreakdown)\b/i;

export function looksTechnical(text: string): boolean {
  return TECHNICAL_RE.test(text);
}

export function formatAcademicYearShort(
  year: string | null | undefined
): string | null {
  const normalized = normalizeAcademicYear(year);
  if (!normalized) {
    const trimmed = (year ?? "").trim();
    return trimmed || null;
  }
  const [start, end] = normalized.split("/");
  if (!start || !end) return normalized;
  return `${start}/${end.slice(-2)}`;
}

export function academicYearStartYear(
  year: string | null | undefined
): number | null {
  const normalized = normalizeAcademicYear(year);
  if (!normalized) return null;
  const start = Number(normalized.slice(0, 4));
  return Number.isFinite(start) ? start : null;
}

export function isPreviousYearRelativeToIntake(
  callYear: string | null | undefined,
  intake: string | null | undefined
): boolean {
  const callStart = academicYearStartYear(callYear);
  const intakeStart = academicYearStartYear(intake);
  if (callStart == null || intakeStart == null) return false;
  return callStart < intakeStart;
}

export function previousYearCallNote(
  callYear: string | null | undefined,
  intake: string | null | undefined,
  indicativeFromYear?: string | null
): string | null {
  const sourceYear = indicativeFromYear || callYear;
  if (!isPreviousYearRelativeToIntake(sourceYear, intake)) return null;
  const from = formatAcademicYearShort(sourceYear);
  const target = formatAcademicYearShort(intake);
  if (!from || !target) return null;
  return `Есть ориентир за ${from}; условия ${target} ещё не опубликованы`;
}

const LANGUAGE_LABELS: Record<string, string> = {
  english: "Английский",
  en: "Английский",
  eng: "Английский",
  inglese: "Английский",
  английский: "Английский",
  italian: "Итальянский",
  it: "Итальянский",
  ita: "Итальянский",
  italiano: "Итальянский",
  итальянский: "Итальянский",
  french: "Французский",
  fr: "Французский",
  german: "Немецкий",
  de: "Немецкий",
};

export function humanizeLanguage(
  language: string | null | undefined
): string | null {
  const raw = (language ?? "").trim();
  if (!raw || looksTechnical(raw)) return null;
  const key = raw.toLowerCase();
  if (LANGUAGE_LABELS[key]) return LANGUAGE_LABELS[key];
  if (key.includes("english") || key.includes("английск")) return "Английский";
  if (key.includes("italian") || key.includes("итальянск")) return "Итальянский";
  return raw;
}

export function ruCount(n: number, one: string, few: string, many: string): string {
  const n10 = n % 10;
  const n100 = n % 100;
  if (n10 === 1 && n100 !== 11) return `${n} ${one}`;
  if (n10 >= 2 && n10 <= 4 && (n100 < 12 || n100 > 14)) return `${n} ${few}`;
  return `${n} ${many}`;
}

function shorten(text: string, max = 90): string {
  const cleaned = text.replace(/\s+/g, " ").trim();
  if (cleaned.length <= max) return cleaned;
  return `${cleaned.slice(0, max - 1).trimEnd()}…`;
}

function mapKnownWhy(reason: string): string | null {
  if (/matches interest/i.test(reason)) {
    return "Подходит по выбранному направлению";
  }
  if (/teaching language matches/i.test(reason)) {
    return "Язык обучения совпадает с вашим выбором";
  }
  if (/taught in english/i.test(reason)) {
    return "Программа на английском";
  }
  if (/preferred city/i.test(reason) || /^город /i.test(reason)) {
    return "Город из вашего списка";
  }
  if (/preferred region/i.test(reason)) {
    return "Регион из вашего списка";
  }
  if (/curator-verified shortlist/i.test(reason)) {
    return "Куратор рекомендует эту программу";
  }
  if (/совпал язык/i.test(reason)) {
    return "Язык обучения совпадает с вашим выбором";
  }
  if (/совпал уровень/i.test(reason)) {
    return "Подходит по уровню обучения";
  }
  if (/направление:/i.test(reason) || /название программы близко/i.test(reason)) {
    return "Подходит по выбранному направлению";
  }
  if (/tuition/i.test(reason) || /budget/i.test(reason)) {
    return null;
  }
  return null;
}

export function humanizeWhyFits(
  reasons: string[],
  curatorNote?: string | null
): string | null {
  const note = (curatorNote ?? "").trim();
  if (note && !looksTechnical(note)) {
    return shorten(note);
  }

  for (const reason of reasons) {
    const raw = reason.trim();
    if (!raw) continue;
    const mapped = mapKnownWhy(raw);
    if (mapped) return mapped;
    if (!looksTechnical(raw) && !/tuition|quota|confidence|fit score/i.test(raw)) {
      return shorten(raw);
    }
  }

  if (reasons.length > 0 || note) {
    return "Подходит по вашим предпочтениям";
  }
  return null;
}
