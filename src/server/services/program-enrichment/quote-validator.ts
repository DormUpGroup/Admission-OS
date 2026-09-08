/** Normalize and validate that a quote appears in source document text. */

export function normalizeQuote(quote: string): string {
  return quote
    .toLowerCase()
    .replace(/[\u00a0\u200b]/g, " ")
    .replace(/[""«»]/g, '"')
    .replace(/['']/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

export function quoteExistsInDocument(
  quote: string,
  documentText: string | null | undefined
): boolean {
  if (!quote?.trim() || !documentText?.trim()) return false;
  const nq = normalizeQuote(quote);
  if (nq.length < 8) return false;
  const nd = normalizeQuote(documentText);
  return nd.includes(nq);
}

/**
 * CMS chrome is often retained in fetched HTML.  It is an official string,
 * but never evidence for an admission decision.  In particular, the word
 * "act" in a cookie/privacy sentence must not become the ACT exam.
 */
export function isBoilerplateEvidenceQuote(quote: string): boolean {
  return /\b(?:cookies? (?:are|is|were)|cookie policy|privacy policy|joint controllers?|all rights reserved|we use cookies|manage cookies)\b/i.test(
    quote
  );
}

export type QuoteValidationResult = {
  accepted: boolean;
  reason?:
    | "missing_quote"
    | "missing_document"
    | "quote_not_found"
    | "boilerplate_quote";
};

export function validateEvidenceQuote(
  quote: string | null | undefined,
  documentText: string | null | undefined
): QuoteValidationResult {
  if (!quote?.trim()) return { accepted: false, reason: "missing_quote" };
  if (!documentText?.trim()) {
    return { accepted: false, reason: "missing_document" };
  }
  if (isBoilerplateEvidenceQuote(quote)) {
    return { accepted: false, reason: "boilerplate_quote" };
  }
  if (!quoteExistsInDocument(quote, documentText)) {
    return { accepted: false, reason: "quote_not_found" };
  }
  return { accepted: true };
}
