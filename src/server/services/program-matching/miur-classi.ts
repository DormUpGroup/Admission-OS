import { normalizeMiurCode } from "@/lib/program-matching/miur-code";
import { listClassi } from "@/server/services/program-ingestion/universitaly-client";

export { normalizeMiurCode };

type ClasseRow = {
  id?: number;
  codice?: string | null;
};

let codeToIdCache: Map<string, number> | null = null;
let cacheLoadedAt = 0;
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

async function loadCodeToIdMap(): Promise<Map<string, number>> {
  const now = Date.now();
  if (codeToIdCache && now - cacheLoadedAt < CACHE_TTL_MS) {
    return codeToIdCache;
  }

  const raw = await listClassi();
  const rows: ClasseRow[] = Array.isArray(raw)
    ? (raw as ClasseRow[])
    : (((raw as { data?: ClasseRow[] })?.data ?? []) as ClasseRow[]);

  const map = new Map<string, number>();
  for (const row of rows) {
    if (row.id == null || !row.codice) continue;
    map.set(normalizeMiurCode(String(row.codice)), Number(row.id));
  }
  codeToIdCache = map;
  cacheLoadedAt = now;
  return map;
}

/** Resolve MIUR classe code (e.g. L-31) → Universitaly `tipoClasse` id. */
export async function resolveClasseId(
  code: string
): Promise<number | null> {
  const map = await loadCodeToIdMap();
  return map.get(normalizeMiurCode(code)) ?? null;
}

export async function resolveClasseIds(
  codes: string[]
): Promise<Array<{ code: string; id: number }>> {
  const map = await loadCodeToIdMap();
  const out: Array<{ code: string; id: number }> = [];
  for (const code of codes) {
    const id = map.get(normalizeMiurCode(code));
    if (id != null) out.push({ code, id });
  }
  return out;
}

/** Test helper — clear cache between unit tests. */
export function clearMiurClasseCache() {
  codeToIdCache = null;
  cacheLoadedAt = 0;
}
