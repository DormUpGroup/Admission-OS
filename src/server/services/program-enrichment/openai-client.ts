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

export function createOpenAiEnrichmentClient(
  apiKey?: string
): EnrichmentLlmClient {
  const key = apiKey ?? getEnrichmentConfig().apiKey;
  const client = new OpenAI({ apiKey: key });
  return {
    async complete(req) {
      const res = await client.chat.completions.create({
        model: req.model,
        messages: req.messages as OpenAI.Chat.ChatCompletionMessageParam[],
        tools: req.tools as OpenAI.Chat.ChatCompletionTool[] | undefined,
        tool_choice: req.tool_choice,
        response_format: req.response_format,
        max_tokens: req.max_tokens,
      });
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
