export {
  getEnrichmentConfig,
  isProgramEnrichmentEnabled,
  ENRICHMENT_PROMPT_VERSION,
} from "./config";
export {
  enrichProgramWithAi,
  toMinimalMatchingContext,
  type AiEnrichResult,
} from "./enrich-program";
export {
  createFakeEnrichmentClient,
  createOpenAiEnrichmentClient,
} from "./openai-client";
export {
  createFakeOfficialSiteNavigator,
  createOfficialSiteNavigator,
} from "./official-site-navigator";
export { validateEvidenceQuote, quoteExistsInDocument } from "./quote-validator";
export { EnrichmentOutputSchema, type EnrichmentOutput } from "./schema";
export { shouldEscalateToTerra, validateOutputQuotes } from "./luna-terra";
export { persistEnrichmentOutput } from "./persist-enrichment";
export { factAppliesToCategory, scopeForApplicantCategory } from "./matching-context";
