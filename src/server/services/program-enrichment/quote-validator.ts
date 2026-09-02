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

export type QuoteValidationResult = {
  accepted: boolean;
  reason?: "missing_quote" | "missing_document" | "quote_not_found";
};

export function validateEvidenceQuote(
  quote: string | null | undefined,
  documentText: string | null | undefined
): QuoteValidationResult {
  if (!quote?.trim()) return { accepted: false, reason: "missing_quote" };
  if (!documentText?.trim()) {
    return { accepted: false, reason: "missing_document" };
  }
  if (!quoteExistsInDocument(quote, documentText)) {
    return { accepted: false, reason: "quote_not_found" };
  }
  return { accepted: true };
}
