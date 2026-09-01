/**
 * Diagnostic miss report on recent SourceDocument snapshots.
 * Run: npm run bando:miss-report -- --limit=50
 */
import { mkdir, writeFile } from "fs/promises";
import path from "path";
import { PrismaClient } from "@prisma/client";
import { parseCallText } from "../src/server/services/program-ingestion/call-text-parse";

const prisma = new PrismaClient();

function parseLimit(argv: string[]): number {
  const flag = argv.find((a) => a.startsWith("--limit="));
  if (flag) {
    const n = Number(flag.split("=")[1]);
    if (Number.isFinite(n) && n > 0) return Math.min(n, 500);
  }
  return 50;
}

async function main() {
  const limit = parseLimit(process.argv.slice(2));
  const docs = await prisma.sourceDocument.findMany({
    where: {
      sourceType: { in: ["ADMISSION_CALL", "PROGRAMME_PAGE"] },
      rawText: { not: null },
    },
    orderBy: { retrievedAt: "desc" },
    take: limit,
    select: {
      id: true,
      url: true,
      sourceType: true,
      extractionQuality: true,
      academicYear: true,
      rawText: true,
      programAcademicYearId: true,
    },
  });

  const rows: Array<Record<string, string | number | boolean | null>> = [];
  for (const d of docs) {
    const body = d.rawText || "";
    const parsed = parseCallText(body, d.url, {
      academicYear: d.academicYear ?? undefined,
    });
    const misses: string[] = [];
    if (parsed.mentionsTuition && !parsed.tuitionMin && !parsed.tuitionMax) {
      misses.push("tuition_cue_empty");
    }
    if (parsed.mentionsDeadline && parsed.deadlines.length === 0) {
      misses.push("deadline_cue_empty");
    }
    if (
      /posti|seats|extra[\s-]?UE|non[\s-]?EU|stranieri/i.test(body) &&
      parsed.nonEuSeats == null
    ) {
      misses.push("seats_cue_empty");
    }
    if (
      /TOLC|SAT|IMAT|IELTS|TOEFL|prova di ammissione/i.test(body) &&
      parsed.exams.length === 0
    ) {
      misses.push("exam_cue_empty");
    }
    if (
      /sbocchi|career opportunities|dopo la laurea/i.test(body) &&
      !parsed.careerOutcomes
    ) {
      misses.push("career_cue_empty");
    }
    if (parsed.quality === "EMPTY") misses.push("quality_empty");

    rows.push({
      id: d.id,
      url: d.url,
      sourceType: d.sourceType,
      extractionQuality: d.extractionQuality,
      quality: parsed.quality,
      coverageMisses: misses.join("|") || null,
      hasTuition: !!(parsed.tuitionMin || parsed.tuitionMax),
      hasDeadline: parsed.deadlines.length > 0,
      hasSeats: parsed.nonEuSeats != null,
      hasExams: parsed.exams.length > 0,
      hasCareer: !!parsed.careerOutcomes,
      accessMode: parsed.accessMode.value,
    });
  }

  const outDir = path.join(process.cwd(), "storage");
  await mkdir(outDir, { recursive: true });
  const jsonPath = path.join(outDir, "bando-miss-report.json");
  await writeFile(
    jsonPath,
    JSON.stringify({ at: new Date().toISOString(), n: rows.length, rows }, null, 2)
  );

  const header = Object.keys(rows[0] || { id: 1 }).join(",");
  const csv = [
    header,
    ...rows.map((r) =>
      header
        .split(",")
        .map((k) => JSON.stringify(r[k] ?? ""))
        .join(",")
    ),
  ].join("\n");
  const csvPath = path.join(outDir, "bando-miss-report.csv");
  await writeFile(csvPath, csv);

  const missCounts: Record<string, number> = {};
  for (const r of rows) {
    const m = String(r.coverageMisses || "");
    if (!m) continue;
    for (const part of m.split("|")) {
      missCounts[part] = (missCounts[part] || 0) + 1;
    }
  }
  console.log({ sampled: rows.length, missCounts });
  console.log("Wrote", jsonPath, "and", csvPath);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
