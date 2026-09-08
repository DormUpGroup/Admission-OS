import { prisma } from "@/lib/db";
import { formatExamAlternatives } from "@/lib/program-matching/examiner-links";
import {
  isBoilerplateEvidenceQuote,
  validateEvidenceQuote,
} from "@/server/services/program-enrichment/quote-validator";
import { factDimensionKey, PROGRAMME_FACT_RESOLVER_VERSION } from "@/server/services/program-matching/programme-fact-contract";
import {
  extractHtmlMainText,
  normalizeOfficialText,
  parseCallText,
} from "./call-text-parse";

type ExamEvidence = {
  alternatives: Array<{ name: string; detail?: string }>;
  description: string;
  quote: string;
};

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Parser section windows may join two distant parts of a CMS page.  Evidence
 * must instead be one continuous sentence from the stored source surface.
 */
function exactExamQuote(
  documentText: string,
  alternatives: Array<{ name: string }>
): string | null {
  const surface = extractHtmlMainText(documentText);
  for (const alternative of alternatives) {
    const token =
      alternative.name === "ADMISSION_TEST"
        ? "(?:admission|entrance)\\s+test"
        : escapeRegExp(alternative.name).replace("\\-", "[-–]?");
    const re = new RegExp(`\\b${token}\\b`, "gi");
    let match: RegExpExecArray | null;
    while ((match = re.exec(surface)) !== null) {
      const start = Math.max(
        surface.lastIndexOf(".", match.index - 1),
        surface.lastIndexOf("!", match.index - 1),
        surface.lastIndexOf("?", match.index - 1),
        surface.lastIndexOf("\n", match.index - 1)
      ) + 1;
      const endings = [
        surface.indexOf(".", match.index),
        surface.indexOf("!", match.index),
        surface.indexOf("?", match.index),
        surface.indexOf("\n", match.index),
      ].filter((index) => index >= 0);
      const end = endings.length ? Math.min(...endings) + 1 : surface.length;
      const quote = normalizeOfficialText(surface.slice(start, end)).slice(0, 1000);
      if (
        quote.length >= 8 &&
        !isBoilerplateEvidenceQuote(quote) &&
        /admission|ammissione|entrance|selection|selezione|enrol|iscriz|initial preparation|assessed through|required|must take/i.test(
          quote
        )
      ) {
        return quote;
      }
    }
  }
  return null;
}

/**
 * This is the invariant between source storage and the card: a named exam is
 * only returned when its exact quote is present in the official document.
 */
export function verifiedExamEvidenceFromText(
  text: string,
  url: string,
  academicYear?: string
): ExamEvidence | null {
  const parsed = parseCallText(text, url, { academicYear });
  const alternatives = parsed.admissionRegime.admissionExams.value;
  const quote = exactExamQuote(text, alternatives);
  if (!alternatives.length || !quote) return null;
  if (!validateEvidenceQuote(quote, text).accepted) return null;
  return {
    alternatives,
    description: formatExamAlternatives(alternatives),
    quote,
  };
}

/**
 * Reconcile every fetched official document after enrichment. This closes the
 * former gap where a document and its quote were stored, but the exam fact was
 * missing from the programme dossier and therefore from the card.
 */
export async function reconcileAdmissionExamsFromStoredSources(
  programAcademicYearId: string
): Promise<{ scannedDocuments: number; savedFactIds: string[] }> {
  const pay = await prisma.programAcademicYear.findUnique({
    where: { id: programAcademicYearId },
    select: {
      id: true,
      programId: true,
      academicYear: true,
      sourceDocuments: {
        where: { rawText: { not: null } },
        select: { id: true, url: true, rawText: true, sourceType: true },
      },
    },
  });
  if (!pay) return { scannedDocuments: 0, savedFactIds: [] };

  // Correct earlier automatic facts that were technically quoted from an
  // official page but came from cookie/privacy chrome rather than admission
  // content. Manual curator confirmations are never touched.
  const staleFacts = await prisma.programFact.findMany({
    where: {
      programAcademicYearId: pay.id,
      field: "ADMISSION_EXAMS",
      superseded: false,
    },
    select: { id: true, evidenceQuote: true, origin: true, sourceType: true },
  });
  const boilerplateFactIds = staleFacts
    .filter(
      (fact) =>
        fact.origin !== "MANUAL_VERIFIED" &&
        fact.sourceType !== "MANUAL_VERIFIED" &&
        !!fact.evidenceQuote &&
        isBoilerplateEvidenceQuote(fact.evidenceQuote)
    )
    .map((fact) => fact.id);
  if (boilerplateFactIds.length > 0) {
    await prisma.programFact.updateMany({
      where: { id: { in: boilerplateFactIds } },
      data: { superseded: true },
    });
  }

  const savedFactIds: string[] = [];
  for (const document of pay.sourceDocuments) {
    const text = document.rawText || "";
    const evidence = verifiedExamEvidenceFromText(
      text,
      document.url,
      pay.academicYear
    );
    if (!evidence) continue;

    const dimensionKey = factDimensionKey({
      field: "ADMISSION_EXAMS",
      scope: "ALL",
      discriminator: evidence.description,
    });
    const existing = await prisma.programFact.findFirst({
      where: {
        programAcademicYearId: pay.id,
        field: "ADMISSION_EXAMS",
        applicantCategoryScope: "ALL",
        dimensionKey,
        superseded: false,
      },
    });
    if (existing?.sourceType === "MANUAL_VERIFIED") continue;

    const data = {
      normalizedValueJson: JSON.stringify({
        alternatives: evidence.alternatives,
        description: evidence.description,
      }),
      rawValue: evidence.description,
      evidenceQuote: evidence.quote,
      sourceDocumentId: document.id,
      sourceUrl: document.url,
      sourceType:
        document.sourceType === "ADMISSION_CALL"
          ? "ADMISSION_CALL"
          : "PROGRAMME_PAGE",
      applicantCategoryScope: "ALL",
      academicYear: pay.academicYear,
      freshness: "CURRENT",
      confidence: "MEDIUM",
      extractionMethod: "RECONCILE_OFFICIAL_EXAM_EVIDENCE",
      origin: "OFFICIAL_FALLBACK",
      decisionStatus: "ELIGIBLE",
      evidenceValidatedAt: new Date(),
      resolverVersion: PROGRAMME_FACT_RESOLVER_VERSION,
      dimensionKey,
      retrievedAt: new Date(),
      superseded: false,
    };
    const fact = existing
      ? await prisma.programFact.update({ where: { id: existing.id }, data })
      : await prisma.programFact.create({
          data: {
            programId: pay.programId,
            programAcademicYearId: pay.id,
            field: "ADMISSION_EXAMS",
            verificationStatus: "UNVERIFIED",
            ...data,
          },
        });
    savedFactIds.push(fact.id);
  }

  return { scannedDocuments: pay.sourceDocuments.length, savedFactIds };
}
