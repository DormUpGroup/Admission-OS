import { describe, expect, it } from "vitest";
import {
  buildOpenAiCompletionRequest,
  isRetryableOpenAiError,
} from "../openai-client";

describe("OpenAI enrichment request", () => {
  it("does not send tool_choice without tools", () => {
    const request = buildOpenAiCompletionRequest({
      model: "gpt-5.6-luna",
      messages: [{ role: "user", content: "Return JSON" }],
      tool_choice: "none",
      response_format: { type: "json_object" },
    });

    expect(request).not.toHaveProperty("tools");
    expect(request).not.toHaveProperty("tool_choice");
  });

  it("keeps tool_choice when function tools are present", () => {
    const request = buildOpenAiCompletionRequest({
      model: "gpt-5.6-luna",
      messages: [{ role: "user", content: "Inspect the official site" }],
      tools: [
        {
          type: "function",
          function: {
            name: "inspect_programme_site",
            description: "Read the programme page",
            parameters: { type: "object" },
          },
        },
      ],
      tool_choice: "auto",
    });

    expect(request).toHaveProperty("tools");
    expect(request).toHaveProperty("tool_choice", "auto");
  });

  it("recognises temporary network failures for retry", () => {
    expect(isRetryableOpenAiError(new Error("Connection error."))).toBe(true);
    expect(isRetryableOpenAiError(new Error("HTTP 429 rate limited"))).toBe(true);
    expect(isRetryableOpenAiError(new Error("400 Invalid value for tools"))).toBe(
      false
    );
  });
});
