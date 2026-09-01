import type { ProgramSourceAdapter } from "./base";
import { rateLimitedFetch } from "../snapshot";
import {
  callParseToLegacy,
  parseCallText,
} from "../call-text-parse";

export type ProgrammePageParse = {
  url: string;
  languages: string[];
  languageLevel: string | null;
  tuitionMin: number | null;
  tuitionMax: number | null;
  deadlines: string[];
  accessMode: "OPEN" | "CLOSED" | "UNKNOWN";
  nonEuSeats: number | null;
  exams: Array<{ name: string; detail?: string }>;
  examAlternatives: Array<{ name: string; detail?: string }>;
  careerOutcomes: string | null;
  publicPrivate: "PUBLIC" | "PRIVATE" | "UNKNOWN";
  mentionsTuition: boolean;
  mentionsDeadline: boolean;
  quality?: "OK" | "LOW" | "EMPTY";
};

export function parseProgrammePageHtml(
  body: string,
  url: string,
  options?: { academicYear?: string }
): ProgrammePageParse {
  const parsed = parseCallText(body, url, {
    academicYear: options?.academicYear,
  });
  return callParseToLegacy(parsed);
}

export const universityWebsiteAdapter: ProgramSourceAdapter = {
  name: "UniversityWebsiteAdapter",
  async discover() {
    return [];
  },
  async fetch(url: string) {
    const res = await rateLimitedFetch(url);
    const body = res.ok ? await res.text() : `FETCH_FAILED ${res.status}`;
    return {
      url,
      body,
      contentType: res.headers.get("content-type") || "text/html",
    };
  },
  async parse(body, meta) {
    return parseProgrammePageHtml(body, meta.url);
  },
  async normalize(raw) {
    return raw;
  },
  async validate() {
    return { ok: true, errors: [] };
  },
};
