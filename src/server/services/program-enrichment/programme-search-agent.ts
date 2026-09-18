import OpenAI from "openai";
import { getEnrichmentConfig } from "./config";

export type ProgrammeSearchResponse = {
  outputText: string;
};

export type ProgrammeSearchClient = {
  search: (input: {
    model: string;
    officialDomain: string;
    instruction: string;
  }) => Promise<ProgrammeSearchResponse>;
};

export type ProgrammeSearchResult =
  | {
      status: "FOUND";
      url: string;
      officialDomain: string;
    }
  | {
      status: "NOT_FOUND" | "FAILED";
      officialDomain: string | null;
      error?: string;
    };

function officialDomain(url: string): string | null {
  try {
    const host = new URL(url).hostname.toLowerCase().replace(/^www\./, "");
    if (!host || host === "localhost" || /^\d+\.\d+\.\d+\.\d+$/.test(host)) {
      return null;
    }
    // The input is already an official university URL from Universitaly. The
    // registrable domain is used because programme pages commonly live on a
    // different university subdomain (e.g. corsi.example.it → www.example.it).
    const parts = host.split(".");
    return parts.length >= 2 ? parts.slice(-2).join(".") : null;
  } catch {
    return null;
  }
}

function isAllowedOfficialUrl(value: string, domain: string): boolean {
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase().replace(/^www\./, "");
    return (
      (url.protocol === "https:" || url.protocol === "http:") &&
      (host === domain || host.endsWith(`.${domain}`))
    );
  } catch {
    return false;
  }
}

function parseCandidateUrl(value: string): string | null {
  try {
    const parsed = JSON.parse(value) as { candidateUrl?: unknown };
    return typeof parsed.candidateUrl === "string" && parsed.candidateUrl.trim()
      ? parsed.candidateUrl.trim()
      : null;
  } catch {
    return null;
  }
}

export function createOpenAiProgrammeSearchClient(
  apiKey = getEnrichmentConfig().apiKey
): ProgrammeSearchClient {
  const openai = new OpenAI({ apiKey });
  return {
    async search(input) {
      const response = await openai.responses.create({
        model: input.model,
        instructions:
          "You are a university programme-page finder. Use web search exactly once. " +
          "Search only the supplied official university domain. Find the exact programme page, " +
          "not a university homepage, generic catalogue, admissions portal, or similarly named programme. " +
          "Return null when the exact programme page cannot be established.",
        input: input.instruction,
        tools: [
          {
            type: "web_search",
            search_context_size: "low",
            filters: { allowed_domains: [input.officialDomain] },
          },
        ],
        tool_choice: "required",
        text: {
          format: {
            type: "json_schema",
            name: "programme_page_candidate",
            strict: true,
            schema: {
              type: "object",
              additionalProperties: false,
              properties: {
                candidateUrl: { type: ["string", "null"] },
              },
              required: ["candidateUrl"],
            },
          },
        },
        max_output_tokens: 250,
        store: false,
      });
      return { outputText: response.output_text };
    },
  };
}

/**
 * A deliberately narrow web-search agent. Search output is only a lead: the
 * caller still fetches the URL and applies exact programme-page verification
 * before it can become a source of programme facts.
 */
export async function findProgrammePageWithWebSearch(input: {
  officialUrl: string;
  programmeNames: Array<string | null | undefined>;
  universityName: string;
  client?: ProgrammeSearchClient;
}): Promise<ProgrammeSearchResult> {
  const domain = officialDomain(input.officialUrl);
  const names = [...new Set(input.programmeNames.filter(
    (name): name is string => Boolean(name?.trim())
  ).map((name) => name.trim()))];
  if (!domain || names.length === 0) {
    return { status: "NOT_FOUND", officialDomain: domain };
  }

  try {
    const cfg = getEnrichmentConfig();
    const result = await (input.client ?? createOpenAiProgrammeSearchClient()).search({
      model: cfg.programmeSearchAgentModel,
      officialDomain: domain,
      instruction: JSON.stringify({
        universityName: input.universityName,
        programmeNames: names,
        knownOfficialUrl: input.officialUrl,
        task: "Return the exact official programme-page URL or null.",
      }),
    });
    const url = parseCandidateUrl(result.outputText);
    if (!url || !isAllowedOfficialUrl(url, domain)) {
      return { status: "NOT_FOUND", officialDomain: domain };
    }
    return { status: "FOUND", url, officialDomain: domain };
  } catch (error) {
    return {
      status: "FAILED",
      officialDomain: domain,
      error: error instanceof Error ? error.message : "programme_search_failed",
    };
  }
}
