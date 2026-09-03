import { getEnrichmentConfig } from "./config";
import type { MinimalMatchingContext } from "./matching-context";
import type {
  ChatMessage,
  EnrichmentLlmClient,
  ToolDefinition,
} from "./openai-client";
import type { OfficialSiteNavigator } from "./official-site-navigator";
import { enrichmentSystemPrompt } from "./prompt/v1";
import { validateEvidenceQuote } from "./quote-validator";
import {
  CRITICAL_FIELDS,
  EnrichmentOutputSchema,
  type EnrichmentOutput,
  type EvidenceFact,
} from "./schema";

export const NAVIGATOR_TOOLS: ToolDefinition[] = [
  {
    type: "function",
    function: {
      name: "inspect_programme_site",
      description:
        "Fetch and inspect the programme officialUrl only. Returns cleaned text, classified internal links, tabs/accordions, and sourceDocumentId.",
      parameters: {
        type: "object",
        properties: {
          officialUrl: { type: "string" },
        },
        required: ["officialUrl"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "follow_official_link",
      description:
        "Follow a previously returned linkId from inspect/follow. Arbitrary URLs are rejected.",
      parameters: {
        type: "object",
        properties: { linkId: { type: "string" } },
        required: ["linkId"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "read_official_section",
      description:
        "Read a tab/accordion section by pageId and sectionId (e.g. Non-EU country, Entrance exam).",
      parameters: {
        type: "object",
        properties: {
          pageId: { type: "string" },
          sectionId: { type: "string" },
        },
        required: ["pageId", "sectionId"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "read_official_pdf",
      description: "Read a previously allowed PDF linkId via text layer / OCR pipeline.",
      parameters: {
        type: "object",
        properties: { linkId: { type: "string" } },
        required: ["linkId"],
      },
    },
  },
];

function userPrompt(ctx: MinimalMatchingContext, forShortlist: boolean): string {
  return JSON.stringify(
    {
      instruction: forShortlist
        ? "Extract only the decision fields needed for an initial curator shortlist: campus, access, selection, admission exams, language requirements, seats, and required documents. Admission-exam investigation is mandatory: inspect the programme page, then use the official links/sections yourself to check an exam/admission path when one is available. Do not return an empty admissionExams array as a conclusion: return documented evidence, documented selection NONE, or add admissionExams to unresolvedFields. Do not navigate to fee/tuition pages and do not look for application deadlines. Return empty arrays for deadlines and tuition."
        : "Extract proven programme card fields for this applicant category using tools only. Return final JSON when done.",
      matchingContext: ctx,
    },
    null,
    2
  );
}

async function dispatchTool(
  navigator: OfficialSiteNavigator,
  name: string,
  argsJson: string
): Promise<string> {
  let args: Record<string, unknown> = {};
  try {
    args = JSON.parse(argsJson) as Record<string, unknown>;
  } catch {
    return JSON.stringify({ error: "invalid_arguments" });
  }
  try {
    if (name === "inspect_programme_site") {
      return JSON.stringify(
        await navigator.inspect_programme_site(String(args.officialUrl ?? ""))
      );
    }
    if (name === "follow_official_link") {
      return JSON.stringify(
        await navigator.follow_official_link(String(args.linkId ?? ""))
      );
    }
    if (name === "read_official_section") {
      return JSON.stringify(
        await navigator.read_official_section(
          String(args.pageId ?? ""),
          String(args.sectionId ?? "")
        )
      );
    }
    if (name === "read_official_pdf") {
      return JSON.stringify(
        await navigator.read_official_pdf(String(args.linkId ?? ""))
      );
    }
    return JSON.stringify({ error: "unknown_tool" });
  } catch (e) {
    return JSON.stringify({
      error: e instanceof Error ? e.message : "tool_failed",
    });
  }
}

function parseOutput(content: string | null): EnrichmentOutput | null {
  if (!content?.trim()) return null;
  try {
    const raw = JSON.parse(content) as unknown;
    const parsed = EnrichmentOutputSchema.safeParse(raw);
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

function collectFacts(output: EnrichmentOutput): EvidenceFact[] {
  return [
    ...output.campuses,
    ...output.access,
    ...output.selection,
    ...output.admissionExams,
    ...output.languageRequirements,
    ...output.deadlines,
    ...output.tuition,
    ...output.seats,
    ...output.requiredDocuments,
    ...output.importantNotes,
  ];
}

export function validateOutputQuotes(
  output: EnrichmentOutput,
  documentTexts: Map<string, string>
): { valid: EnrichmentOutput; rejectCount: number; invalidCritical: string[] } {
  const reject = { count: 0 };
  const filterFacts = (facts: EvidenceFact[]) =>
    facts.filter((f) => {
      const ok = validateEvidenceQuote(
        f.quote,
        documentTexts.get(f.sourceDocumentId)
      ).accepted;
      if (!ok) reject.count += 1;
      return ok;
    });

  const valid: EnrichmentOutput = {
    ...output,
    campuses: filterFacts(output.campuses),
    access: filterFacts(output.access),
    selection: filterFacts(output.selection),
    admissionExams: filterFacts(output.admissionExams),
    languageRequirements: filterFacts(output.languageRequirements),
    deadlines: filterFacts(output.deadlines),
    tuition: filterFacts(output.tuition),
    seats: filterFacts(output.seats),
    requiredDocuments: filterFacts(output.requiredDocuments),
    importantNotes: filterFacts(output.importantNotes),
  };

  const invalidCritical: string[] = [];
  for (const key of CRITICAL_FIELDS) {
    if (output[key].length > 0 && valid[key].length === 0) {
      invalidCritical.push(key);
    }
  }
  return { valid, rejectCount: reject.count, invalidCritical };
}

export function shouldEscalateToTerra(input: {
  output: EnrichmentOutput | null;
  quoteRejects: number;
  invalidCritical: string[];
  forShortlist: boolean;
  categorySpecificRules: boolean;
}): boolean {
  const cfg = getEnrichmentConfig();
  if (!cfg.escalationEnabled) return false;
  if (!input.output) return true;
  if (input.quoteRejects > 0) return true;
  const relevantInvalidCritical = input.forShortlist
    ? input.invalidCritical.filter((field) => field !== "deadlines" && field !== "tuition")
    : input.invalidCritical;
  if (relevantInvalidCritical.length > 0) return true;
  if (input.output.sourceConflicts.length > 0) return true;
  const relevantCritical: readonly string[] = input.forShortlist
    ? CRITICAL_FIELDS.filter((field) => field !== "deadlines" && field !== "tuition")
    : CRITICAL_FIELDS;
  const unresolvedCritical = input.output.unresolvedFields.filter((f) =>
    relevantCritical.includes(f as (typeof CRITICAL_FIELDS)[number])
  );
  if (unresolvedCritical.length > 0 && input.forShortlist) return true;
  if (input.categorySpecificRules && unresolvedCritical.length > 0) return true;
  return false;
}

export type LunaTerraResult = {
  output: EnrichmentOutput | null;
  model: string;
  escalated: boolean;
  toolCallCount: number;
  inputTokens: number;
  outputTokens: number;
  quoteRejectCount: number;
};

export async function runLunaTerraEnrichment(input: {
  ctx: MinimalMatchingContext;
  navigator: OfficialSiteNavigator;
  client: EnrichmentLlmClient;
  forShortlist?: boolean;
}): Promise<LunaTerraResult> {
  const cfg = getEnrichmentConfig();
  const officialUrl = input.ctx.program.officialUrl;
  if (!officialUrl) {
    return {
      output: null,
      model: cfg.model,
      escalated: false,
      toolCallCount: 0,
      inputTokens: 0,
      outputTokens: 0,
      quoteRejectCount: 0,
    };
  }

  async function runModel(model: string): Promise<{
    output: EnrichmentOutput | null;
    inputTokens: number;
    outputTokens: number;
  }> {
    const messages: ChatMessage[] = [
      {
        role: "system",
        content: enrichmentSystemPrompt(cfg.promptVersion),
      },
      { role: "user", content: userPrompt(input.ctx, input.forShortlist ?? false) },
    ];

    let inputTokens = 0;
    let outputTokens = 0;
    const maxRounds = cfg.maxToolCalls + 2;

    for (let round = 0; round < maxRounds; round++) {
      const res = await input.client.complete({
        model,
        messages,
        tools: NAVIGATOR_TOOLS,
        tool_choice: "auto",
        response_format: { type: "json_object" },
        max_tokens: cfg.maxOutputTokens,
      });
      inputTokens += res.usage?.inputTokens ?? 0;
      outputTokens += res.usage?.outputTokens ?? 0;

      if (res.tool_calls.length > 0) {
        messages.push({
          role: "assistant",
          content: res.content,
          tool_calls: res.tool_calls.map((t) => ({
            id: t.id,
            type: "function",
            function: { name: t.name, arguments: t.arguments },
          })),
        });
        for (const call of res.tool_calls) {
          const result = await dispatchTool(
            input.navigator,
            call.name,
            call.arguments
          );
          messages.push({
            role: "tool",
            tool_call_id: call.id,
            content: result,
          });
        }
        continue;
      }

      return {
        output: parseOutput(res.content),
        inputTokens,
        outputTokens,
      };
    }

    return { output: null, inputTokens, outputTokens };
  }

  const luna = await runModel(cfg.model);
  const docs = input.navigator.getDocuments();
  const docTexts = new Map(
    [...docs.entries()].map(([id, d]) => [id, d.text])
  );

  let quoteRejectCount = 0;
  let invalidCritical: string[] = [];
  let output = luna.output;
  if (output) {
    const v = validateOutputQuotes(output, docTexts);
    output = v.valid;
    quoteRejectCount = v.rejectCount;
    invalidCritical = v.invalidCritical;
  }

  const categorySpecific =
    input.ctx.applicantCategory === "NON_EU_RESIDENT_ABROAD" ||
    input.ctx.applicantCategory === "NON_EU_RESIDENT_ITALY" ||
    input.ctx.applicantCategory === "EU_CITIZEN" ||
    input.ctx.applicantCategory === "EU_EQUIVALENT";

  const escalate = shouldEscalateToTerra({
    output,
    quoteRejects: quoteRejectCount,
    invalidCritical,
    forShortlist: input.forShortlist ?? false,
    categorySpecificRules: categorySpecific,
  });

  let escalated = false;
  let model = cfg.model;
  let inputTokens = luna.inputTokens;
  let outputTokens = luna.outputTokens;

  if (escalate) {
    escalated = true;
    model = cfg.escalationModel;
    const terra = await runModel(cfg.escalationModel);
    inputTokens += terra.inputTokens;
    outputTokens += terra.outputTokens;
    if (terra.output) {
      const refreshedDocs = input.navigator.getDocuments();
      const refreshedTexts = new Map(
        [...refreshedDocs.entries()].map(([id, d]) => [id, d.text])
      );
      const v = validateOutputQuotes(terra.output, refreshedTexts);
      // Only keep Terra facts that pass quote validation; do not keep invalid Luna facts
      output = v.valid;
      quoteRejectCount = v.rejectCount;
    } else {
      // Terra failed — do not keep dubious Luna critical facts with bad quotes
      output = output
        ? {
            ...output,
            unresolvedFields: [
              ...new Set([
                ...output.unresolvedFields,
                ...invalidCritical,
                ...CRITICAL_FIELDS.filter((f) => output && output[f].length === 0),
              ]),
            ],
          }
        : null;
    }
  }

  void collectFacts;
  return {
    output,
    model,
    escalated,
    toolCallCount: input.navigator.toolCallCount(),
    inputTokens,
    outputTokens,
    quoteRejectCount,
  };
}
