import type { DiscoverResult, ProgramSourceAdapter } from "./base";
import { MVP_CATALOG } from "../catalog-fixtures";
import { rateLimitedFetch } from "../snapshot";
import { searchCorsi } from "../universitaly-client";

/**
 * Universitaly adapter — live Cineca JSON discovery with fixture fallback.
 * Universitaly is NOT treated as final admission-requirements authority.
 */
export const universitalyAdapter: ProgramSourceAdapter = {
  name: "UniversitalyAdapter",
  async discover(academicYear: string): Promise<DiscoverResult[]> {
    try {
      const live = await searchCorsi(
        { order: "ASC", searchType: "u", page: 1 },
        { maxPages: 2 }
      );
      if (live.corsi.length > 0) {
        return live.corsi.map((c) => ({
          externalId: String(c.id),
          title: c.nomeCorsoEn || c.nomeCorso || "Programme",
          universityName: c.nomeStruttura || "Unknown",
          city: c.sede?.comuneDescrizione || undefined,
          degreeLevel:
            Number(c.durataAnni) === 2
              ? "MASTER"
              : Number(c.durataAnni) === 5 || Number(c.durataAnni) === 6
                ? "SINGLE_CYCLE"
                : "BACHELOR",
          language: (c.lingua || "").toUpperCase().includes("EN")
            ? "English"
            : "Italian",
          field: c.classe?.descrizione || c.area || undefined,
          officialUrl: c.url || undefined,
          universitalyUrl: `https://www.universitaly.it/index.php/public/schedaCorso/${c.id}`,
          academicYear: c.anno?.descrizione || academicYear,
        }));
      }
    } catch {
      // fall through to fixtures
    }

    return MVP_CATALOG.filter(
      (p) =>
        !p.academicYear ||
        p.academicYear === academicYear ||
        p.academicYear.startsWith(academicYear.slice(0, 4))
    ).map((p) => ({
      externalId: p.universitalyExternalId,
      title: p.title,
      universityName: p.universityName,
      city: p.city,
      region: p.region,
      degreeLevel: p.degreeLevel,
      language: p.language,
      field: p.field,
      officialUrl: p.officialUrl,
      universitalyUrl: p.universitalyUrl,
      academicYear: p.academicYear || academicYear,
    }));
  },
  async fetch(url: string) {
    try {
      const res = await rateLimitedFetch(url);
      if (!res.ok) {
        return {
          url,
          body: `FETCH_FAILED ${res.status}`,
          contentType: "text/plain",
        };
      }
      const body = await res.text();
      return {
        url,
        body,
        contentType: res.headers.get("content-type") || "text/html",
      };
    } catch (e) {
      return {
        url,
        body: `FETCH_ERROR ${e instanceof Error ? e.message : "unknown"}`,
        contentType: "text/plain",
      };
    }
  },
  async parse(body, meta) {
    return {
      url: meta.url,
      titleHint: body.match(/<title[^>]*>([^<]+)<\/title>/i)?.[1] ?? null,
      hasAdmission: /admission|bando|requisiti|requirements/i.test(body),
      length: body.length,
    };
  },
  async normalize(raw) {
    return raw;
  },
  async validate(normalized) {
    return {
      ok: typeof normalized.url === "string",
      errors: typeof normalized.url === "string" ? [] : ["url missing"],
    };
  },
};
