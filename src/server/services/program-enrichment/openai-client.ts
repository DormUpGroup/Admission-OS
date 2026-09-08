import OpenAI from "openai";
import { getEnrichmentConfig } from "./config";

export type ChatMessage = {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_call_id?: string;
  tool_calls?: Array<{
    id: string;
    type: "function";
    function: { name: string; arguments: string };
  }>;
};

export type ToolDefinition = {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
};

export type ChatCompletionRequest = {
  model: string;
  messages: ChatMessage[];
  tools?: ToolDefinition[];
  tool_choice?: "auto" | "none";
  response_format?: { type: "json_object" };
  max_tokens?: number;
};

export type ChatCompletionResponse = {
  content: string | null;
  tool_calls: Array<{
    id: string;
    name: string;
    arguments: string;
  }>;
  usage?: { inputTokens: number; outputTokens: number };
};

export type EnrichmentLlmClient = {
  complete: (req: ChatCompletionRequest) => Promise<ChatCompletionResponse>;
};

export function isRetryableOpenAiError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /connection error|network|econnreset|etimedout|fetch failed|\b429\b|\b5\d\d\b/i.test(
    message
  );
}

function retryDelay(attempt: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 250 * (attempt + 1)));
}

/**
 * `tool_choice` is only valid when function tools are included in the request.
 * The final, retrieval-only pass deliberately has no tools, so forwarding
 * `tool_choice: "none"` there makes the API reject the entire enrichment run.
 */
export function buildOpenAiCompletionRequest(req: ChatCompletionRequest) {
  const toolOptions =
    req.tools && req.tools.length > 0
      ? {
          tools: req.tools as OpenAI.Chat.ChatCompletionTool[],
          tool_choice: req.tool_choice ?? "auto",
        }
      : {};

  return {
    model: req.model,
    messages: req.messages as OpenAI.Chat.ChatCompletionMessageParam[],
    ...toolOptions,
    response_format: req.response_format,
    max_tokens: req.max_tokens,
    // gpt-5.6-luna accepts function tools in Chat Completions only when
    // reasoning is explicitly disabled. Without this, enrichment fails
    // before the model can inspect any official admissions pages.
    reasoning_effort: "none" as const,
  };
}

export function createOpenAiEnrichmentClient(
  apiKey?: string
): EnrichmentLlmClient {
  const key = apiKey ?? getEnrichmentConfig().apiKey;
  const client = new OpenAI({ apiKey: key });
  return {
    async complete(req) {
      let res: OpenAI.Chat.Completions.ChatCompletion | null = null;
      for (let attempt = 0; attempt < 3; attempt += 1) {
        try {
          res = await client.chat.completions.create(
            buildOpenAiCompletionRequest(req)
          );
          break;
        } catch (error) {
          if (attempt === 2 || !isRetryableOpenAiError(error)) throw error;
          await retryDelay(attempt);
        }
      }
      if (!res) throw new Error("openai_completion_unavailable");
      const choice = res.choices[0]?.message;
      const tool_calls = (choice?.tool_calls ?? [])
        .filter((t) => t.type === "function")
        .map((t) => ({
          id: t.id,
          name: t.function.name,
          arguments: t.function.arguments,
        }));
      return {
        content: choice?.content ?? null,
        tool_calls,
        usage: {
          inputTokens: res.usage?.prompt_tokens ?? 0,
          outputTokens: res.usage?.completion_tokens ?? 0,
        },
      };
    },
  };
}

/** Test double: scripted responses by call index. */
export function createFakeEnrichmentClient(
  script: Array<ChatCompletionResponse | ((req: ChatCompletionRequest) => ChatCompletionResponse)>
): EnrichmentLlmClient & { callCount: number } {
  let callCount = 0;
  return {
    get callCount() {
      return callCount;
    },
    async complete(req) {
      const entry = script[callCount];
      callCount += 1;
      if (!entry) {
        return {
          content: JSON.stringify({
            campuses: [],
            access: [],
            selection: [],
            admissionExams: [],
            languageRequirements: [],
            deadlines: [],
            tuition: [],
            seats: [],
            requiredDocuments: [],
            importantNotes: [],
            sourceConflicts: [],
            unresolvedFields: ["ALL"],
            siteNavigationSummary: { hops: [], documentsUsed: [] },
          }),
          tool_calls: [],
        };
      }
      return typeof entry === "function" ? entry(req) : entry;
    },
  };
}
