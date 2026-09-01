/**
 * Explains which dossier fields are still unknown after the batch4 live run.
 * Run: npx tsx scripts/diagnose-match-batch4.ts
 */
import { PrismaClient } from "@prisma/client";
import { getProgramDossier } from "../src/server/services/program-matching/program-dossier";

const prisma = new PrismaClient();
const EMAILS = ["p", "q", "r", "s", "t", "u", "v", "w", "x", "y"].map(
  (letter) => `match-test-${letter}@student.local`
);

type Field =
  | "call"
  | "language"
  | "access"
  | "tuition"
  | "nonEuSeats"
  | "deadline"
  | "exams"
  | "career";

function sourcePreview(raw: string | null): string | null {
  if (!raw) return null;
  const text = raw.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  const hit = text.search(/accesso|programmato|posti|seats|tasse|tuition|contribuzione|admission|test/i);
  if (hit < 0) return text.slice(0, 320) || null;
  return text.slice(Math.max(0, hit - 90), hit + 320);
}

function missingFields(dossier: Awaited<ReturnType<typeof getProgramDossier>>): Field[] {
  if (!dossier) {
    return [
      "call",
      "language",
      "access",
      "tuition",
      "nonEuSeats",
      "deadline",
      "exams",
      "career",
    ];
  }
  const fields: Field[] = [];
  if (!dossier.admissionCallUrl) fields.push("call");
  if (!dossier.languageRequirement && dossier.teachingLanguages.length === 0) {
    fields.push("language");
  }
  if (dossier.accessMode === "UNKNOWN") fields.push("access");
  if (
    dossier.tuitionMin == null &&
    dossier.tuitionMax == null &&
    dossier.tuitionFixed == null
  ) fields.push("tuition");
  if (dossier.nonEuSeats == null && !dossier.seatsUnlimited) fields.push("nonEuSeats");
  if (!dossier.deadlines.some((deadline) => deadline.deadline != null)) {
    fields.push("deadline");
  }
  if (!dossier.examsDisplay && dossier.selection !== "NONE") fields.push("exams");
  if (!dossier.careerOutcomes) fields.push("career");
  return fields;
}

async function main() {
  const students = await prisma.student.findMany({
    where: { email: { in: EMAILS } },
    orderBy: { email: "asc" },
    select: { id: true, email: true },
  });
  const matches = await prisma.programMatch.findMany({
    where: { studentId: { in: students.map((s) => s.id) } },
    include: {
      student: { select: { email: true } },
      programAcademicYear: {
        include: {
          program: { include: { university: true } },
          sourceDocuments: {
            orderBy: { retrievedAt: "desc" },
            take: 8,
            select: { sourceType: true, extractionQuality: true, parserVersion: true, url: true, rawText: true },
          },
          facts: {
            where: { superseded: false },
            select: { field: true, sourceType: true, confidence: true },
          },
        },
      },
    },
    orderBy: [{ student: { email: "asc" } }, { fitScore: "desc" }],
  });

  const byField: Record<Field, number> = {
    call: 0,
    access: 0,
    tuition: 0,
    nonEuSeats: 0,
    deadline: 0,
    exams: 0,
    career: 0,
    language: 0,
  };
  const reasons: Record<string, number> = {};
  const rows = [];
  for (const match of matches) {
    const dossier = await getProgramDossier(match.programAcademicYearId);
    const missing = missingFields(dossier);
    for (const field of missing) byField[field] += 1;
    const docs = match.programAcademicYear.sourceDocuments;
    const facts = match.programAcademicYear.facts;
    let cause: string;
    if (!match.programAcademicYear.program.officialUrl) cause = "no_official_url";
    else if (docs.length === 0) cause = "not_enriched";
    else if (docs.every((d) => d.extractionQuality === "EMPTY")) cause = "empty_source_text";
    else if (docs.some((d) => d.extractionQuality === "LOW")) cause = "partial_source_text";
    else if (!docs.some((d) => d.sourceType === "ADMISSION_CALL")) cause = "no_discovered_call";
    else cause = "field_not_stated_or_not_recognised";
    reasons[cause] = (reasons[cause] ?? 0) + 1;
    rows.push({
      student: match.student.email,
      program: match.programAcademicYear.program.name,
      university: match.programAcademicYear.program.university.name,
      officialUrl: match.programAcademicYear.program.officialUrl,
      year: match.programAcademicYear.academicYear,
      missing,
      cause,
      callFreshness: dossier?.callFreshness ?? "unknown",
      selection: dossier?.selection ?? "UNKNOWN",
      docs: docs.map((d) => ({
        type: d.sourceType,
        quality: d.extractionQuality,
        parser: d.parserVersion,
        url: d.url,
        preview: sourcePreview(d.rawText),
      })),
      facts: facts.map((f) => f.field),
    });
  }
  const output = {
    generatedAt: new Date().toISOString(),
    students: students.length,
    matches: matches.length,
    unknownByField: byField,
    causes: reasons,
    rows,
  };
  const fs = await import("fs");
  fs.writeFileSync("scripts/match-batch4-diagnosis.json", JSON.stringify(output, null, 2));
  console.log(JSON.stringify({ ...output, rows: rows.slice(0, 12) }, null, 2));
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
