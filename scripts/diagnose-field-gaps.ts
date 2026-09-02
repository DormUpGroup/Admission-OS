/**
 * Groups empty critical dossier fields by reason / cause with university + snippets.
 * Counts ALL empty fields (filled+explained previous-year values are not empty).
 * Run: npx tsx scripts/diagnose-field-gaps.ts
 */
import { writeFileSync } from "fs";
import path from "path";
import { PrismaClient } from "@prisma/client";
import {
  CRITICAL_PROGRAM_FIELDS,
  isFieldExplained,
  isFieldFilled,
  type CriticalProgramField,
} from "../src/lib/program-matching/field-status";
import { getProgramDossier } from "../src/server/services/program-matching/program-dossier";
import { QA_SUITE_EMAILS } from "./qa-suite-emails";

const prisma = new PrismaClient();

type GapCause =
  | "link_not_found"
  | "wrong_page"
  | "non_admission_bando"
  | "target_year_not_published"
  | "previous_year_only"
  | "html_cue_unparsed"
  | "pdf_low_extraction"
  | "pdf_needs_ocr"
  | "field_absent_in_official_source"
  | "source_not_programme_specific"
  | "private_libero_unverified"
  | "fetch_failed"
  | "unexplained";

function mapReasonToCause(reason: string | null): GapCause {
  switch (reason) {
    case "OFFICIAL_SOURCE_NOT_FOUND":
      return "link_not_found";
    case "SOURCE_FETCH_FAILED":
      return "fetch_failed";
    case "NOT_PUBLISHED_FOR_TARGET_YEAR":
      return "target_year_not_published";
    case "ONLY_PREVIOUS_YEAR_AVAILABLE":
      return "previous_year_only";
    case "SCANNED_PDF_NEEDS_OCR":
      return "pdf_needs_ocr";
    case "OFFICIAL_SOURCE_DOES_NOT_STATE_FIELD":
      return "field_absent_in_official_source";
    case "CURATOR_CONFIRMATION_NEEDED":
      return "private_libero_unverified";
    case null:
      return "unexplained";
    default:
      return "html_cue_unparsed";
  }
}

function previewFromRaw(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const text = raw.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  const hit = text.search(
    /accesso|programmato|posti|seats|tasse|tuition|contribuzione|ISEE|ammissione|TOLC|deadline|scadenza|B2|C1/i
  );
  if (hit < 0) return text.slice(0, 280) || null;
  return text.slice(Math.max(0, hit - 60), hit + 280);
}

async function main() {
  const students = await prisma.student.findMany({
    where: { email: { in: QA_SUITE_EMAILS } },
    select: { id: true, email: true },
  });
  const [programCorpus, universityCount] = await Promise.all([
    prisma.program.count(),
    prisma.university.count(),
  ]);
  console.log(
    `Diagnose scope: ${students.length}/${QA_SUITE_EMAILS.length} QA profiles · ${programCorpus} programmes · ${universityCount} universities`
  );

  const byCause: Record<string, number> = {};
  const byReason: Record<string, number> = {};
  const byFieldReason: Record<string, number> = {};
  const byUniversity: Record<string, number> = {};
  const unexplainedByField: Record<string, number> = {};
  const snippets: Array<{
    university: string;
    program: string;
    field: string;
    reason: string | null;
    cause: GapCause;
    sourceUrl: string | null;
    textPreview: string | null;
  }> = [];

  let emptyTotal = 0;
  let unexplainedTotal = 0;

  for (const student of students) {
    const matches = await prisma.programMatch.findMany({
      where: { studentId: student.id },
      include: {
        programAcademicYear: {
          include: {
            program: { include: { university: true } },
            sourceDocuments: {
              orderBy: { retrievedAt: "desc" },
              take: 3,
              select: { rawText: true, url: true, sourceType: true },
            },
          },
        },
      },
    });
    for (const match of matches) {
      const dossier = await getProgramDossier(match.programAcademicYearId);
      if (!dossier) continue;
      const uni = dossier.universityName;
      const docPreview =
        previewFromRaw(match.programAcademicYear.sourceDocuments[0]?.rawText) ??
        null;

      for (const field of CRITICAL_PROGRAM_FIELDS) {
        const status = dossier.fieldStatuses[field as CriticalProgramField];
        if (isFieldFilled(status)) continue;

        emptyTotal += 1;
        const reason = status.reason;
        const cause = mapReasonToCause(reason);
        byCause[cause] = (byCause[cause] ?? 0) + 1;
        const reasonKey = reason ?? "NO_REASON";
        byReason[reasonKey] = (byReason[reasonKey] ?? 0) + 1;
        const fr = `${field}:${reasonKey}`;
        byFieldReason[fr] = (byFieldReason[fr] ?? 0) + 1;
        byUniversity[uni] = (byUniversity[uni] ?? 0) + 1;

        if (!isFieldExplained(status)) {
          unexplainedTotal += 1;
          unexplainedByField[field] = (unexplainedByField[field] ?? 0) + 1;
        }

        if (snippets.length < 40) {
          snippets.push({
            university: uni,
            program: dossier.programName,
            field,
            reason,
            cause,
            sourceUrl: status.sourceUrl,
            textPreview: docPreview,
          });
        }
      }
    }
  }

  const topUniversities = Object.entries(byUniversity)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 15)
    .map(([name, count]) => ({ name, count }));

  const topFieldReasons = Object.entries(byFieldReason)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 30)
    .map(([key, count]) => ({ key, count }));

  const out = {
    generatedAt: new Date().toISOString(),
    students: students.length,
    emptyTotal,
    unexplainedTotal,
    byCause,
    byReason,
    topFieldReasons,
    unexplainedByField,
    topUniversities,
    sampleSnippets: snippets,
  };

  const outPath = path.join(process.cwd(), "scripts", "diagnose-field-gaps.json");
  writeFileSync(outPath, JSON.stringify(out, null, 2));
  console.log("Wrote", outPath);
  console.log("Empty:", emptyTotal, "Unexplained:", unexplainedTotal);
  console.log("Top reasons:", byReason);
  console.log("Top field:reason:", topFieldReasons.slice(0, 10));
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
