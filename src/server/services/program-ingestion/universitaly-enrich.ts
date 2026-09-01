import { prisma } from "@/lib/db";
import { universityWebsiteAdapter } from "@/server/services/program-ingestion/adapters/university-website";
import { upsertSourceDocument } from "@/server/services/program-ingestion/snapshot";
import type { UpsertedCandidate } from "./universitaly-upsert";

const ENRICH_TIMEOUT_MS = 12_000;

async function fetchWithTimeout(url: string): Promise<{
  ok: boolean;
  body: string;
  contentType: string;
}> {
  try {
    const fetchFn = universityWebsiteAdapter.fetch;
    if (!fetchFn) {
      return { ok: false, body: "FETCH_ERROR no_adapter", contentType: "text/plain" };
    }
    const fetched = await Promise.race([
      fetchFn(url),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("enrich_timeout")), ENRICH_TIMEOUT_MS)
      ),
    ]);
    return {
      ok:
        !fetched.body.startsWith("FETCH_FAILED") &&
        !fetched.body.startsWith("FETCH_ERROR"),
      body: fetched.body,
      contentType: fetched.contentType,
    };
  } catch (e) {
    return {
      ok: false,
      body: `FETCH_ERROR ${e instanceof Error ? e.message : "unknown"}`,
      contentType: "text/plain",
    };
  }
}

export type LightEnrichResult = {
  programAcademicYearId: string;
  enriched: boolean;
  reason?: string;
};

/**
 * Light-enrich candidate official URLs via university-website adapter + snapshots.
 * Never blocks match generation — failures leave NEEDS_REVIEW / LOW–MEDIUM confidence.
 */
export async function lightEnrichCandidates(
  candidates: UpsertedCandidate[]
): Promise<LightEnrichResult[]> {
  const results: LightEnrichResult[] = [];

  for (const c of candidates) {
    if (!c.officialUrl) {
      results.push({
        programAcademicYearId: c.programAcademicYearId,
        enriched: false,
        reason: "no_official_url",
      });
      continue;
    }

    const pay = await prisma.programAcademicYear.findUnique({
      where: { id: c.programAcademicYearId },
      include: { program: true },
    });
    if (!pay) {
      results.push({
        programAcademicYearId: c.programAcademicYearId,
        enriched: false,
        reason: "pay_missing",
      });
      continue;
    }

    const fetched = await fetchWithTimeout(c.officialUrl);
    const isHtml =
      /html/i.test(fetched.contentType) ||
      /<!doctype html|<html/i.test(fetched.body.slice(0, 500));
    const isPdf =
      /pdf/i.test(fetched.contentType) ||
      c.officialUrl.toLowerCase().endsWith(".pdf");

    if (!fetched.ok || (!isHtml && isPdf)) {
      // PDF OCR is out of scope — keep Universitaly URL for curator
      results.push({
        programAcademicYearId: c.programAcademicYearId,
        enriched: false,
        reason: !fetched.ok ? "fetch_failed" : "pdf_deferred",
      });
      continue;
    }

    if (!isHtml) {
      results.push({
        programAcademicYearId: c.programAcademicYearId,
        enriched: false,
        reason: "non_html",
      });
      continue;
    }

    const parseFn = universityWebsiteAdapter.parse;
    const parsed = parseFn
      ? await parseFn(fetched.body, { url: c.officialUrl })
      : { languages: [] as string[] };

    const snap = await upsertSourceDocument({
      sourceType: "PROGRAMME_PAGE",
      sourceAuthority: pay.program.name,
      url: c.officialUrl,
      title: `${pay.program.name} — programme page snapshot`,
      academicYear: pay.academicYear,
      universityId: pay.program.universityId,
      programId: pay.programId,
      programAcademicYearId: pay.id,
      contentType: "html",
      body: fetched.body.slice(0, 100_000),
      status: "FETCHED",
      extractionQuality: "NEEDS_REVIEW",
    });

    const langs = Array.isArray((parsed as { languages?: string[] }).languages)
      ? (parsed as { languages: string[] }).languages
      : [];

    if (langs.length > 0) {
      const existing = await prisma.programFact.findFirst({
        where: {
          programId: pay.programId,
          programAcademicYearId: pay.id,
          field: "TEACHING_LANGUAGE",
          superseded: false,
        },
      });
      const value = { languages: langs, fromProgrammePage: true };
      if (existing) {
        await prisma.programFact.update({
          where: { id: existing.id },
          data: {
            normalizedValueJson: JSON.stringify(value),
            sourceDocumentId: snap.document.id,
            sourceUrl: c.officialUrl,
            sourceType: "PROGRAMME_PAGE",
            confidence: "MEDIUM",
            retrievedAt: new Date(),
          },
        });
      } else {
        await prisma.programFact.create({
          data: {
            programId: pay.programId,
            programAcademicYearId: pay.id,
            field: "TEACHING_LANGUAGE",
            normalizedValueJson: JSON.stringify(value),
            sourceDocumentId: snap.document.id,
            sourceUrl: c.officialUrl,
            sourceType: "PROGRAMME_PAGE",
            academicYear: pay.academicYear,
            confidence: "MEDIUM",
            extractionMethod: "HTML_HEURISTIC",
            verificationStatus: "UNVERIFIED",
          },
        });
      }

      await prisma.program.update({
        where: { id: pay.programId },
        data: {
          teachingLanguagesJson: JSON.stringify(langs),
          language: langs[0] ?? pay.program.language,
        },
      });
    }

    await prisma.programAcademicYear.update({
      where: { id: pay.id },
      data: {
        dataConfidence:
          pay.dataConfidence === "HIGH" ? "HIGH" : "MEDIUM",
        lastUpdatedAt: new Date(),
      },
    });

    results.push({
      programAcademicYearId: c.programAcademicYearId,
      enriched: true,
    });
  }

  return results;
}
