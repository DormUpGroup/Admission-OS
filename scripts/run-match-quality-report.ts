/**
 * Machine-readable + human quality report for QA suite matches.
 * Run: npx tsx scripts/run-match-quality-report.ts [--compare=scripts/match-quality-previous.json]
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import path from "path";
import { PrismaClient } from "@prisma/client";
import {
  CRITICAL_PROGRAM_FIELDS,
  isFieldExplained,
  isFieldFilled,
  type CriticalProgramField,
} from "../src/lib/program-matching/field-status";
import {
  DEFAULT_TARGET_ACADEMIC_YEAR,
  MATCHING_ENGINE_VERSION,
  PARSER_VERSION,
} from "../src/lib/program-matching/config";
import { getProgramDossier } from "../src/server/services/program-matching/program-dossier";
import { QA_SUITE_EMAILS } from "./qa-suite-emails";

const prisma = new PrismaClient();

type PreviousReport = {
  aggregate?: {
    totalCriticalFields?: number;
    rawUnknown?: number;
    rawUnknownRate?: number;
    unexplainedUnknown?: number;
    unexplainedUnknownRate?: number;
    acceptableEmptyShare?: number;
    byField?: Record<string, { rawUnknownRate: number; unexplainedUnknownRate: number }>;
  };
};

function parseCompareArg(): string | null {
  const flag = process.argv.find((a) => a.startsWith("--compare="));
  return flag ? flag.split("=")[1] : null;
}

async function main() {
  const comparePath = parseCompareArg();
  const previous: PreviousReport | null =
    comparePath && existsSync(comparePath)
      ? (JSON.parse(readFileSync(comparePath, "utf8")) as PreviousReport)
      : null;

  const students = await prisma.student.findMany({
    where: { email: { in: QA_SUITE_EMAILS } },
    select: { id: true, email: true, intake: true },
  });

  const [programCorpus, universityCount] = await Promise.all([
    prisma.program.count(),
    prisma.university.count(),
  ]);
  console.log(
    `Report scope: ${students.length}/${QA_SUITE_EMAILS.length} QA profiles · ${programCorpus} programmes · ${universityCount} universities (full base)`
  );

  const byField: Record<
    CriticalProgramField,
    { total: number; rawUnknown: number; unexplainedUnknown: number }
  > = Object.fromEntries(
    CRITICAL_PROGRAM_FIELDS.map((f) => [f, { total: 0, rawUnknown: 0, unexplainedUnknown: 0 }])
  ) as Record<
    CriticalProgramField,
    { total: number; rawUnknown: number; unexplainedUnknown: number }
  >;

  let falseSourceRejections = 0;
  let ocrSuccess = 0;
  let ocrFailure = 0;
  let manualReview = 0;
  const emptyByReason: Record<string, number> = {};
  const cards: Array<Record<string, unknown>> = [];
  const studentSummaries: Array<Record<string, unknown>> = [];

  for (const student of students) {
    const matches = await prisma.programMatch.findMany({
      where: { studentId: student.id },
      include: {
        programAcademicYear: {
          include: {
            program: { include: { university: true } },
          },
        },
      },
      orderBy: { fitScore: "desc" },
      take: 20,
    });

    studentSummaries.push({
      email: student.email,
      intake: student.intake,
      matchCount: matches.length,
      top5: matches.slice(0, 5).map((m) => ({
        program: m.programAcademicYear.program.name,
        university: m.programAcademicYear.program.university.name,
        fit: m.fitScore,
      })),
    });

    for (const match of matches) {
      const dossier = await getProgramDossier(match.programAcademicYearId);
      if (!dossier) continue;

      const traceFact = await prisma.programFact.findFirst({
        where: {
          programAcademicYearId: match.programAcademicYearId,
          field: "ENRICHMENT_TRACE",
          superseded: false,
        },
        select: { normalizedValueJson: true },
      });
      if (traceFact?.normalizedValueJson) {
        try {
          const trace = JSON.parse(traceFact.normalizedValueJson) as {
            falseSourceRejections?: number;
            ocrSuccessCount?: number;
            ocrFailureCount?: number;
          };
          falseSourceRejections += trace.falseSourceRejections ?? 0;
          ocrSuccess += trace.ocrSuccessCount ?? 0;
          ocrFailure += trace.ocrFailureCount ?? 0;
        } catch {
          /* ignore */
        }
      }

      const fieldRows: Record<string, unknown> = {};
      for (const field of CRITICAL_PROGRAM_FIELDS) {
        const status = dossier.fieldStatuses[field];
        byField[field].total += 1;
        if (!isFieldFilled(status)) {
          byField[field].rawUnknown += 1;
          const reason = status.reason ?? "UNEXPLAINED";
          emptyByReason[reason] = (emptyByReason[reason] ?? 0) + 1;
        }
        if (!isFieldExplained(status)) {
          byField[field].unexplainedUnknown += 1;
          if (status.reason === "CURATOR_CONFIRMATION_NEEDED") manualReview += 1;
        }
        fieldRows[field] = {
          value: status.value,
          reason: status.reason,
          sourceUrl: status.sourceUrl,
          sourceAcademicYear: status.sourceAcademicYear,
          targetIntakeYear: status.targetIntakeYear,
          sourceType: status.sourceType,
          extractionQuality: status.extractionQuality,
          parserVersion: status.parserVersion,
          freshness: status.freshness,
          scope: status.scope,
        };
      }

      cards.push({
        student: student.email,
        program: dossier.programName,
        university: dossier.universityName,
        academicYear: dossier.academicYear,
        targetIntake: student.intake ?? DEFAULT_TARGET_ACADEMIC_YEAR,
        fields: fieldRows,
      });
    }
  }

  const totalCriticalFields = CRITICAL_PROGRAM_FIELDS.reduce(
    (sum, f) => sum + byField[f].total,
    0
  );
  const rawUnknown = CRITICAL_PROGRAM_FIELDS.reduce(
    (sum, f) => sum + byField[f].rawUnknown,
    0
  );
  const unexplainedUnknown = CRITICAL_PROGRAM_FIELDS.reduce(
    (sum, f) => sum + byField[f].unexplainedUnknown,
    0
  );

  const byFieldRates = Object.fromEntries(
    CRITICAL_PROGRAM_FIELDS.map((f) => {
      const t = byField[f].total || 1;
      return [
        f,
        {
          rawUnknownRate: byField[f].rawUnknown / t,
          unexplainedUnknownRate: byField[f].unexplainedUnknown / t,
          filled: t - byField[f].rawUnknown,
          total: t,
        },
      ];
    })
  );

  const acceptableEmpty =
    emptyByReason.NOT_PUBLISHED_FOR_TARGET_YEAR ?? 0;
  const acceptableEmptyShare = rawUnknown ? acceptableEmpty / rawUnknown : 0;

  const aggregate = {
    cards: cards.length,
    students: students.length,
    totalCriticalFields,
    rawUnknownRate: totalCriticalFields ? rawUnknown / totalCriticalFields : 0,
    unexplainedUnknownRate: totalCriticalFields
      ? unexplainedUnknown / totalCriticalFields
      : 0,
    rawUnknown,
    unexplainedUnknown,
    emptyByReason,
    acceptableEmptyShare,
    byField: byFieldRates,
    falseSourceRejections,
    ocrSuccess,
    ocrFailure,
    manualReviewCases: manualReview,
  };

  const report = {
    generatedAt: new Date().toISOString(),
    engine: MATCHING_ENGINE_VERSION,
    parser: PARSER_VERSION,
    targetIntake: DEFAULT_TARGET_ACADEMIC_YEAR,
    scope: {
      qaProfiles: QA_SUITE_EMAILS.length,
      qaProfilesFound: students.length,
      programCorpus,
      universities: universityCount,
      universityFilter: null,
    },
    aggregate,
    students: studentSummaries,
    cards,
  };

  const jsonPath = path.join(process.cwd(), "scripts", "match-quality-latest.json");
  const prevPath = path.join(process.cwd(), "scripts", "match-quality-previous.json");
  if (existsSync(jsonPath)) {
    copyFileSync(jsonPath, prevPath);
  }
  writeFileSync(jsonPath, JSON.stringify(report, null, 2));

  const mdLines = [
    "# Program Matching Quality Report",
    "",
    `**Generated:** ${report.generatedAt}`,
    `**Engine:** ${MATCHING_ENGINE_VERSION} · **Parser:** ${PARSER_VERSION}`,
    `**Target intake:** ${DEFAULT_TARGET_ACADEMIC_YEAR}`,
    "",
    "## Aggregate",
    "",
    `| Metric | Value |`,
    `|--------|-------|`,
    `| QA students | ${students.length} |`,
    `| Programme cards | ${cards.length} |`,
    `| Program corpus (DB) | ${programCorpus} programmes / ${universityCount} universities |`,
    `| Critical field observations | ${totalCriticalFields} |`,
    `| Raw unknown rate | ${(aggregate.rawUnknownRate * 100).toFixed(1)}% |`,
    `| Unexplained unknown rate | ${(aggregate.unexplainedUnknownRate * 100).toFixed(1)}% |`,
    `| False-source rejections | ${falseSourceRejections} |`,
    `| OCR success / failure | ${ocrSuccess} / ${ocrFailure} |`,
    `| Acceptable empty share (NOT_PUBLISHED / all empties) | ${(aggregate.acceptableEmptyShare * 100).toFixed(1)}% |`,
    "",
    "## Empty reasons",
    "",
    "| Reason | Count |",
    "|--------|------:|",
    ...Object.entries(emptyByReason)
      .sort((a, b) => b[1] - a[1])
      .map(([reason, count]) => `| ${reason} | ${count} |`),
    "",
    "## Per-field fill",
    "",
    "| Field | Filled | Raw unknown % | Unexplained unknown % |",
    "|-------|--------|---------------|------------------------|",
  ];

  for (const f of CRITICAL_PROGRAM_FIELDS) {
    const row = byFieldRates[f];
    mdLines.push(
      `| ${f} | ${row.filled}/${row.total} | ${(row.rawUnknownRate * 100).toFixed(1)}% | ${(row.unexplainedUnknownRate * 100).toFixed(1)}% |`
    );
  }

  if (previous?.aggregate) {
    mdLines.push("", "## Before / after", "");
    mdLines.push("| Metric | Previous | Current |");
    mdLines.push("|--------|----------|---------|");
    const prevUnexplained = previous.aggregate.unexplainedUnknownRate ?? 0;
    mdLines.push(
      `| Unexplained unknown (total) | ${(prevUnexplained * 100).toFixed(1)}% | ${(aggregate.unexplainedUnknownRate * 100).toFixed(1)}% |`
    );
    const prevRaw = previous.aggregate.rawUnknownRate ?? 0;
    mdLines.push(
      `| Raw unknown (total) | ${(prevRaw * 100).toFixed(1)}% | ${(aggregate.rawUnknownRate * 100).toFixed(1)}% |`
    );
    const prevAcceptable = previous.aggregate.acceptableEmptyShare;
    if (typeof prevAcceptable === "number") {
      mdLines.push(
        `| Acceptable empty share | ${(prevAcceptable * 100).toFixed(1)}% | ${(aggregate.acceptableEmptyShare * 100).toFixed(1)}% |`
      );
    }
  }

  mdLines.push(
    "",
    "## Notes",
    "",
    "- `unexplained_unknown` = empty field without classified reason and verified source.",
    "- Honest reasons (`NOT_PUBLISHED_FOR_TARGET_YEAR`, `ONLY_PREVIOUS_YEAR_AVAILABLE`, etc.) count as explained.",
    "- Career is excluded from critical-field metrics.",
    ""
  );

  const mdPath = path.join(process.cwd(), "docs", "program-matching-quality-latest.md");
  mkdirSync(path.dirname(mdPath), { recursive: true });
  writeFileSync(mdPath, mdLines.join("\n"));

  console.log("Wrote", jsonPath);
  console.log("Wrote", mdPath);
  console.log(
    "Unexplained unknown:",
    (aggregate.unexplainedUnknownRate * 100).toFixed(1) + "%"
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
