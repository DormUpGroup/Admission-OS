/** OpenAI programme enrichment configuration (second filter). */

function envBool(name: string, fallback: boolean): boolean {
  const v = process.env[name];
  if (v == null || v === "") return fallback;
  return ["1", "true", "yes", "on"].includes(v.toLowerCase());
}

function envInt(name: string, fallback: number): number {
  const v = process.env[name];
  if (v == null || v === "") return fallback;
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

function envStr(name: string, fallback: string): string {
  const v = process.env[name];
  return v != null && v.trim() ? v.trim() : fallback;
}

export const ENRICHMENT_PROMPT_VERSION = envStr(
  "OPENAI_PROGRAM_ENRICHMENT_PROMPT_VERSION",
  "v2"
);

export function isProgramEnrichmentEnabled(): boolean {
  if (!process.env.OPENAI_API_KEY?.trim()) return false;
  return envBool("OPENAI_PROGRAM_ENRICHMENT_ENABLED", false);
}

export function getEnrichmentConfig() {
  return {
    enabled: isProgramEnrichmentEnabled(),
    apiKey: process.env.OPENAI_API_KEY?.trim() || "",
    model: envStr("OPENAI_PROGRAM_ENRICHMENT_MODEL", "gpt-5.6-luna"),
    escalationModel: envStr(
      "OPENAI_PROGRAM_ENRICHMENT_ESCALATION_MODEL",
      "gpt-5.6-terra"
    ),
    escalationEnabled: envBool("OPENAI_PROGRAM_ENRICHMENT_ESCALATION_ENABLED", true),
    maxCandidates: envInt("OPENAI_PROGRAM_ENRICHMENT_MAX_CANDIDATES", 35),
    maxDocuments: envInt("OPENAI_PROGRAM_ENRICHMENT_MAX_DOCUMENTS", 5),
    maxHops: envInt("OPENAI_PROGRAM_ENRICHMENT_MAX_HOPS", 5),
    maxToolCalls: envInt("OPENAI_PROGRAM_ENRICHMENT_MAX_TOOL_CALLS", 6),
    maxOutputTokens: (() => {
      const raw = process.env.OPENAI_PROGRAM_ENRICHMENT_MAX_OUTPUT_TOKENS;
      if (!raw?.trim()) return undefined;
      const n = Number(raw);
      return Number.isFinite(n) && n > 0 ? Math.floor(n) : undefined;
    })(),
    promptVersion: ENRICHMENT_PROMPT_VERSION,
    maxPageBytes: 1_500_000,
    domainRateLimitMs: 800,
  };
}

export type EnrichmentConfig = ReturnType<typeof getEnrichmentConfig>;
