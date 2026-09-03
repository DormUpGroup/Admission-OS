import { getEnrichmentConfig } from "./config";
import {
  formatRetrievalContext,
  retrieveSections,
  sectionsFromExtracted,
  type RetrievalQuery,
  type RetrievalSectionInput,
} from "./document-sections";
import type { CriticalField } from "./schema";
import { enrichmentFieldsForMode } from "./eligible-facts";
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
        "Fetch and inspect the programme officialUrl only. Returns classified internal links, section labels, ranked relevant snippets, and sourceDocumentId (not the full page text).",
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
      description: "Read a previously allowed PDF linkId via text layer / OCR pipeline. Returns ranked relevant snippets and sourceDocumentId (not the full PDF text).",
      parameters: {
        type: "object",
        properties: { linkId: { type: "string" } },
        required: ["linkId"],
      },
    },
  },
];

function userPrompt(
  ctx: MinimalMatchingContext,
  forShortlist: boolean,
  alreadyResolvedFields: CriticalField[] = []
): string {
  return JSON.stringify(
    {
      instruction: forShortlist
        ? "Extract only the decision fields needed for an initial curator shortlist: campus, access, selection, admission exams, language requirements, seats, and required documents. Admission-exam investigation is mandatory: inspect the programme page, then use the official links/sections yourself to check an exam/admission path when one is available. Do not return an empty admissionExams array as a conclusion: return documented evidence, documented selection NONE, or add admissionExams to unresolvedFields. Do not navigate to fee/tuition pages and do not look for application deadlines. Return empty arrays for deadlines and tuition."
        : "Extract proven programme card fields for this applicant category using tools only. Return final JSON when done.",
      matchingContext: ctx,
      alreadyResolvedFields,
      alreadyResolvedNote:
        alreadyResolvedFields.length > 0
          ? "Do not re-extract alreadyResolvedFields. Eligible official facts already exist for them."
          : undefined,
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

function collectNavigatorSections(
  navigator: OfficialSiteNavigator
): RetrievalSectionInput[] {
  const sections: RetrievalSectionInput[] = [];
  for (const [id, doc] of navigator.getDocuments().entries()) {
    sections.push(
      ...sectionsFromExtracted({
        sourceDocumentId: id,
        sourceUrl: doc.url,
        academicYear: doc.academicYear,
        sourceType: doc.sourceType,
        sourceAuthority: doc.sourceAuthority,
        sections: doc.sections,
      })
    );
  }
  return sections;
}

function retrievalQuery(
  ctx: MinimalMatchingContext,
  forShortlist: boolean,
  sourceDocumentIds?: string[]
): RetrievalQuery {
  return {
    academicYear: ctx.targetAcademicYear,
    applicantCategory: ctx.applicantCategory,
    mode: forShortlist ? "shortlist" : "dossier",
    sourceDocumentIds,
    neededFields: enrichmentFieldsForMode(forShortlist),
  };
}

function buildRetrievalPack(
  navigator: OfficialSiteNavigator,
  ctx: MinimalMatchingContext,
  forShortlist: boolean,
  sourceDocumentIds?: string[]
): string {
  const result = retrieveSections(
    collectNavigatorSections(navigator),
    retrievalQuery(ctx, forShortlist, sourceDocumentIds)
  );
  return formatRetrievalContext(result);
}

function slimToolResult(
  name: string,
  raw: string,
  navigator: OfficialSiteNavigator,
  ctx: MinimalMatchingContext,
  forShortlist: boolean
): string {
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return raw;
  }
  if (parsed.error) return raw;

  if (name === "inspect_programme_site" || name === "follow_official_link") {
    const sourceDocumentId = String(parsed.sourceDocumentId ?? "");
    const snippets = retrieveSections(
      collectNavigatorSections(navigator).filter(
        (section) => !sourceDocumentId || section.sourceDocumentId === sourceDocumentId
      ),
      retrievalQuery(ctx, forShortlist, sourceDocumentId ? [sourceDocumentId] : undefined)
    );
    return JSON.stringify({
      pageId: parsed.pageId,
      url: parsed.url,
      title: parsed.title,
      sourceDocumentId: parsed.sourceDocumentId,
      contentHash: parsed.contentHash,
      links: parsed.links,
      sections: Array.isArray(parsed.sections)
        ? (parsed.sections as Array<{ sectionId?: string; label?: string; kind?: string }>).map(
            (section) => ({
              sectionId: section.sectionId,
              label: section.label,
              kind: section.kind,
            })
          )
        : [],
      relevantSnippets: snippets.snippets.map((snippet) => ({
        sourceDocumentId: snippet.sourceDocumentId,
        sourceUrl: snippet.sourceUrl,
        heading: snippet.heading,
        sectionType: snippet.sectionType,
        text: snippet.text,
      })),
    });
  }

  if (name === "read_official_pdf") {
    const sourceDocumentId = String(parsed.sourceDocumentId ?? "");
    const snippets = retrieveSections(
      collectNavigatorSections(navigator).filter(
        (section) => !sourceDocumentId || section.sourceDocumentId === sourceDocumentId
      ),
      retrievalQuery(ctx, forShortlist, sourceDocumentId ? [sourceDocumentId] : undefined)
    );
    return JSON.stringify({
      sourceDocumentId: parsed.sourceDocumentId,
      url: parsed.url,
      contentHash: parsed.contentHash,
      method: parsed.method,
      relevantSnippets: snippets.snippets.map((snippet) => ({
        sourceDocumentId: snippet.sourceDocumentId,
        sourceUrl: snippet.sourceUrl,
        heading: snippet.heading,
        sectionType: snippet.sectionType,
        text: snippet.text,
      })),
    });
  }

  return raw;
}

const RETRIEVAL_FINAL_INSTRUCTIONS =
  "Tool budget is exhausted. Do not call tools again. Return only the final JSON using the official evidence already available below. Retrieved sections help locate evidence in inspected official documents; they are not themselves a source of truth. Confirm a fact only with a verbatim quote that appears in the official document. If a field cannot be proven, add it to unresolvedFields.\n\nRetrieved official sections:\n";

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

function relevantCriticalFields(
  forShortlist: boolean,
  alreadyResolved: CriticalField[] = []
) {
  const resolved = new Set<CriticalField>(alreadyResolved);
  return enrichmentFieldsForMode(forShortlist).filter((field) => !resolved.has(field));
}

/**
 * Models occasionally return a schema-valid object with empty arrays and no
 * unresolvedFields. Make missing coverage explicit so Luna escalates instead
 * of silently passing an empty card to persistence.
 */
function markMissingCriticalFields(
  output: EnrichmentOutput,
  forShortlist: boolean,
  alreadyResolved: CriticalField[] = []
): EnrichmentOutput {
  const missing = relevantCriticalFields(forShortlist, alreadyResolved).filter(
    (field) => output[field].length === 0
  );
  return {
    ...output,
    unresolvedFields: [...new Set([...output.unresolvedFields, ...missing])],
  };
}

/**
 * A shortlist result containing only language/campus metadata is not a useful
 * second filter. Require at least one admission decision fact; otherwise the
 * AI run is failed/null so the caller can start deterministic, evidence-first
 * fallback instead of persisting an empty programme card.
 */
export function isUsableEnrichmentOutput(
  output: EnrichmentOutput,
  forShortlist: boolean,
  alreadyResolved: CriticalField[] = []
): boolean {
  const resolvedAdmission = alreadyResolved.some((field) =>
    field === "access" ||
    field === "selection" ||
    field === "admissionExams" ||
    field === "seats"
  );
  if (!forShortlist) {
    return collectFacts(output).length > 0 || alreadyResolved.length > 0;
  }
  return (
    output.access.length > 0 ||
    output.selection.length > 0 ||
    output.admissionExams.length > 0 ||
    output.seats.length > 0 ||
    resolvedAdmission
  );
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
  alreadyResolvedFields?: CriticalField[];
}): boolean {
  const cfg = getEnrichmentConfig();
  if (!cfg.escalationEnabled) return false;
  if (!input.output) return true;
  if (input.quoteRejects > 0) return true;
  const resolved = new Set<string>(input.alreadyResolvedFields ?? []);
  const relevantInvalidCritical = relevantCriticalFields(
    input.forShortlist,
    input.alreadyResolvedFields
  ).filter((field) => input.invalidCritical.includes(field));
  if (relevantInvalidCritical.length > 0) return true;
  if (input.output.sourceConflicts.length > 0) return true;
  const relevantCritical = relevantCriticalFields(
    input.forShortlist,
    input.alreadyResolvedFields
  );
  const unresolvedCritical = input.output.unresolvedFields.filter((f) =>
    relevantCritical.includes(f as CriticalField) && !resolved.has(f)
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
  alreadyResolvedFields?: CriticalField[];
}): Promise<LunaTerraResult> {
  const cfg = getEnrichmentConfig();
  const alreadyResolved = input.alreadyResolvedFields ?? [];
  const forShortlist = input.forShortlist ?? false;
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
      { role: "user", content: userPrompt(input.ctx, forShortlist, alreadyResolved) },
    ];

    let inputTokens = 0;
    let outputTokens = 0;
    const maxRounds = cfg.maxToolCalls + 2;
    let forcedFinal = false;

    for (let round = 0; round < maxRounds; round++) {
      const toolBudgetExhausted = input.navigator.toolCallCount() >= cfg.maxToolCalls;
      if (toolBudgetExhausted && !forcedFinal) {
        messages.push({
          role: "user",
          content:
            RETRIEVAL_FINAL_INSTRUCTIONS +
            buildRetrievalPack(input.navigator, input.ctx, forShortlist),
        });
        forcedFinal = true;
      }
      const res = await input.client.complete({
        model,
        messages,
        tools: forcedFinal ? undefined : NAVIGATOR_TOOLS,
        tool_choice: forcedFinal ? "none" : "auto",
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
            content: slimToolResult(
              call.name,
              result,
              input.navigator,
              input.ctx,
              forShortlist
            ),
          });
        }
        continue;
      }

      const parsed = parseOutput(res.content);
      const needsRecovery =
        !parsed || !isUsableEnrichmentOutput(parsed, forShortlist, alreadyResolved);
      if (!needsRecovery || forcedFinal) {
        return { output: parsed, inputTokens, outputTokens };
      }

      // A model can finish after inspecting the right source but still emit an
      // invalid/empty JSON object. Do one final, tool-free pass over the
      // documents already fetched instead of throwing that evidence away.
      messages.push({
        role: "user",
        content:
          "The prior final answer was empty, invalid, or insufficient for a programme card. Do not call tools. Return only schema-valid final JSON. Preserve exact quotes; mark unproven fields unresolved.\n\n" +
          RETRIEVAL_FINAL_INSTRUCTIONS +
          buildRetrievalPack(input.navigator, input.ctx, forShortlist),
      });
      const recovery = await input.client.complete({
        model,
        messages,
        tool_choice: "none",
        response_format: { type: "json_object" },
        max_tokens: cfg.maxOutputTokens,
      });
      inputTokens += recovery.usage?.inputTokens ?? 0;
      outputTokens += recovery.usage?.outputTokens ?? 0;
      return {
        output: parseOutput(recovery.content),
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
    output = markMissingCriticalFields(
      v.valid,
      forShortlist,
      alreadyResolved
    );
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
    forShortlist,
    categorySpecificRules: categorySpecific,
    alreadyResolvedFields: alreadyResolved,
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
      output = markMissingCriticalFields(
        v.valid,
        forShortlist,
        alreadyResolved
      );
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

  if (
    output &&
    !isUsableEnrichmentOutput(output, forShortlist, alreadyResolved)
  ) {
    output = null;
  }

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
