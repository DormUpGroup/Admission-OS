import {
  UNIVERSITALY_BACKEND_BASE,
  UNIVERSITALY_MAX_PAGES,
} from "@/lib/program-matching/config";
import { rateLimitedFetch } from "./snapshot";

export type UniversitalySearchQuery = {
  searchText?: string;
  area?: string;
  lingua?: "EN" | "IT";
  durata?: string;
  tipoAccesso?: string;
  modalitaErogazione?: string;
  tipoClasse?: string | number;
  provincia?: string;
  provinciaSigla?: string;
  order?: "ASC" | "DESC" | "RND";
  searchType?: "u" | "a";
  page?: number;
};

export type UniversitalyCorso = {
  id: string | number;
  nomeCorso?: string;
  nomeCorsoEn?: string;
  nomeStruttura?: string;
  lingua?: string | null;
  durataAnni?: string | number | null;
  url?: string | null;
  area?: string | null;
  idStrutture?: number | string | null;
  codeUn?: string | null;
  anno?: {
    id?: number;
    descrizione?: string;
  } | null;
  tipoLaurea?: {
    id?: number;
    descrizione?: string;
    descrizioneEn?: string;
  } | null;
  classe?: {
    id?: number;
    codice?: string;
    descrizione?: string;
    tipoClasse?: string;
  } | null;
  programmazione?: {
    id?: number;
    descrizione?: string;
  } | null;
  modalitaAccesso?: {
    id?: number;
    descrizione?: string;
  } | null;
  modalitaErogazione?: {
    id?: number;
    codice?: string;
    descrizione?: string;
  } | null;
  sede?: {
    comuneDescrizione?: string;
  } | null;
};

export type UniversitalySearchPage = {
  corsi: UniversitalyCorso[];
  totalResults: number;
  totalPages: number;
  currentPage: number;
};

export type UniversitalySearchResult = {
  corsi: UniversitalyCorso[];
  totalResults: number;
  totalPages: number;
  pagesFetched: number;
  truncated: boolean;
  errors: string[];
  query: UniversitalySearchQuery;
};

function buildUrl(path: string, query: Record<string, string | number | undefined>) {
  const url = new URL(`${UNIVERSITALY_BACKEND_BASE}${path}`);
  for (const [k, v] of Object.entries(query)) {
    if (v === undefined || v === null || v === "") continue;
    url.searchParams.set(k, String(v));
  }
  return url.toString();
}

async function cinecaGet<T>(
  path: string,
  query: Record<string, string | number | undefined> = {}
): Promise<T> {
  const url = buildUrl(path, query);
  const res = await rateLimitedFetch(url, {
    headers: {
      Accept: "application/json",
      Origin: "https://www.universitaly.it",
      Referer: "https://www.universitaly.it/it/cerca-corsi",
    },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Universitaly ${res.status}: ${body.slice(0, 200)}`);
  }
  return (await res.json()) as T;
}

export function normalizeCercaCorsiPage(json: unknown): UniversitalySearchPage {
  const raw = json as Record<string, unknown>;
  // Flat shape when searchType=u
  if (Array.isArray(raw.corsi) && raw.universita === undefined) {
    return {
      corsi: raw.corsi as UniversitalyCorso[],
      totalResults: Number(raw.totalResults ?? 0),
      totalPages: Number(raw.totalPages ?? 0),
      currentPage: Number(raw.currentPage ?? 1),
    };
  }
  const uni = (raw.universita ?? {}) as Record<string, unknown>;
  return {
    corsi: (uni.corsi as UniversitalyCorso[]) ?? [],
    totalResults: Number(uni.totalResults ?? 0),
    totalPages: Number(uni.totalPages ?? 0),
    currentPage: Number(uni.currentPage ?? 1),
  };
}

function normalizePage(json: unknown): UniversitalySearchPage {
  return normalizeCercaCorsiPage(json);
}

export async function listClassi() {
  return cinecaGet<unknown[]>("/api/offerta-formativa/lista-classi");
}

export async function listProvince() {
  return cinecaGet<{ statusCode?: number; data?: unknown[] }>(
    "/api/usocomune/province"
  );
}

export async function searchCorsiPage(
  query: UniversitalySearchQuery
): Promise<UniversitalySearchPage> {
  const json = await cinecaGet<unknown>("/api/offerta-formativa/cerca-corsi", {
    searchText: query.searchText,
    area: query.area,
    lingua: query.lingua,
    durata: query.durata,
    tipoAccesso: query.tipoAccesso,
    modalitaErogazione: query.modalitaErogazione,
    tipoClasse: query.tipoClasse,
    provincia: query.provincia,
    provinciaSigla: query.provinciaSigla,
    order: query.order ?? "ASC",
    searchType: query.searchType ?? "u",
    page: query.page ?? 1,
  });
  return normalizePage(json);
}

/**
 * Paged university-only search with hard cap (default 5 pages / ~50 programmes).
 * Never invents results — on error returns partial + errors[].
 */
export async function searchCorsi(
  query: UniversitalySearchQuery,
  options?: { maxPages?: number }
): Promise<UniversitalySearchResult> {
  const maxPages = options?.maxPages ?? UNIVERSITALY_MAX_PAGES;
  const errors: string[] = [];
  const byId = new Map<string, UniversitalyCorso>();
  let totalResults = 0;
  let totalPages = 0;
  let pagesFetched = 0;

  for (let page = 1; page <= maxPages; page++) {
    try {
      const result = await searchCorsiPage({ ...query, page, searchType: "u" });
      pagesFetched = page;
      totalResults = result.totalResults;
      totalPages = result.totalPages || totalPages;
      for (const c of result.corsi) {
        byId.set(String(c.id), c);
      }
      if (!result.totalPages || page >= result.totalPages) break;
      if (result.corsi.length === 0) break;
    } catch (e) {
      errors.push(e instanceof Error ? e.message : String(e));
      break;
    }
  }

  return {
    corsi: [...byId.values()],
    totalResults,
    totalPages,
    pagesFetched,
    truncated: totalPages > pagesFetched,
    errors,
    query,
  };
}
