/**
 * Run persistProgramMatches for all match-test-* students and print dossier fill stats.
 * Run: npx tsx scripts/run-match-test-batch.ts
 */
import { PrismaClient } from "@prisma/client";
import { persistProgramMatches } from "../src/server/services/program-matching/program-matching";
import { getProgramDossier } from "../src/server/services/program-matching/program-dossier";

const prisma = new PrismaClient();

const EMAILS = [
  "match-test-a@student.local",
  "match-test-b@student.local",
  "match-test-c@student.local",
  "match-test-d@student.local",
  "match-test-e@student.local",
];

type FieldStats = {
  n: number;
  tuition: number;
  deadline: number;
  accessKnown: number;
  seats: number;
  exams: number;
  langReq: number;
  career: number;
  callFact: number;
  callUrl: number;
  extractOk: number;
  extractLow: number;
};

function emptyStats(): FieldStats {
  return {
    n: 0,
    tuition: 0,
    deadline: 0,
    accessKnown: 0,
    seats: 0,
    exams: 0,
    langReq: 0,
    career: 0,
    callFact: 0,
    callUrl: 0,
    extractOk: 0,
    extractLow: 0,
  };
}

async function main() {
  const global = emptyStats();
  const perStudent: Array<{
    email: string;
    matches: number;
    candidates?: number;
    source?: string;
    warning?: string | null;
    top: string[];
    fill: FieldStats;
  }> = [];

  for (const email of EMAILS) {
    const student = await prisma.student.findUnique({ where: { email } });
    if (!student) {
      console.error("Missing student", email);
      continue;
    }

    console.log("\n========", email, "========");
    const persisted = await persistProgramMatches(student.id);
    console.log("Persisted", persisted.matches.length, {
      source: persisted.liveMeta?.source,
      candidates: persisted.liveMeta?.candidateCount,
      warning: persisted.liveMeta?.warning,
    });

    const fill = emptyStats();
    const top: string[] = [];

    for (const m of persisted.matches) {
      const dossier = await getProgramDossier(m.programAcademicYearId);
      fill.n += 1;
      global.n += 1;
      if (!dossier) continue;

      const hasTuition =
        dossier.tuitionMin != null ||
        dossier.tuitionMax != null ||
        dossier.tuitionFixed != null;
      const hasDeadline = dossier.deadlines.some((d) => d.deadline);
      const accessKnown =
        dossier.accessMode === "OPEN" || dossier.accessMode === "CLOSED";

      if (hasTuition) {
        fill.tuition += 1;
        global.tuition += 1;
      }
      if (hasDeadline) {
        fill.deadline += 1;
        global.deadline += 1;
      }
      if (accessKnown) {
        fill.accessKnown += 1;
        global.accessKnown += 1;
      }
      if (dossier.nonEuSeats != null) {
        fill.seats += 1;
        global.seats += 1;
      }
      if (dossier.examsDisplay) {
        fill.exams += 1;
        global.exams += 1;
      }
      if (dossier.languageRequirement) {
        fill.langReq += 1;
        global.langReq += 1;
      }
      if (dossier.careerOutcomes) {
        fill.career += 1;
        global.career += 1;
      }
      if (dossier.callFreshness === "current") {
        fill.callFact += 1;
        global.callFact += 1;
      }
      if (dossier.admissionCallUrl) {
        fill.callUrl += 1;
        global.callUrl += 1;
      }
      if (dossier.extractQuality === "OK") {
        fill.extractOk += 1;
        global.extractOk += 1;
      }
      if (
        dossier.extractQuality === "LOW_EXTRACTION_QUALITY" ||
        dossier.extractQuality === "NEEDS_REVIEW"
      ) {
        fill.extractLow += 1;
        global.extractLow += 1;
      }

      if (top.length < 5) {
        top.push(
          `[${m.eligibilityStatus}] ${m.fitScore} ${m.universityName} / ${m.programName} | tuition=${hasTuition ? "Y" : "N"} deadline=${hasDeadline ? "Y" : "N"} access=${dossier.accessMode} call=${dossier.callFreshness}`
        );
      }
    }

    for (const line of top) console.log(" ", line);
    console.log("Fill", fill);

    perStudent.push({
      email,
      matches: persisted.matches.length,
      candidates: persisted.liveMeta?.candidateCount,
      source: persisted.liveMeta?.source,
      warning: persisted.liveMeta?.warning ?? null,
      top,
      fill,
    });
  }

  const pct = (x: number) =>
    global.n ? `${Math.round((x / global.n) * 100)}%` : "n/a";

  console.log("\n======== GLOBAL FILL (all matched dossiers) ========");
  console.log({
    dossiers: global.n,
    tuition: `${global.tuition} (${pct(global.tuition)})`,
    deadline: `${global.deadline} (${pct(global.deadline)})`,
    accessKnown: `${global.accessKnown} (${pct(global.accessKnown)})`,
    nonEuSeats: `${global.seats} (${pct(global.seats)})`,
    exams: `${global.exams} (${pct(global.exams)})`,
    languageReq: `${global.langReq} (${pct(global.langReq)})`,
    career: `${global.career} (${pct(global.career)})`,
    admissionCallFact: `${global.callFact} (${pct(global.callFact)})`,
    admissionCallUrl: `${global.callUrl} (${pct(global.callUrl)})`,
    extractOk: `${global.extractOk} (${pct(global.extractOk)})`,
    extractLowReview: `${global.extractLow} (${pct(global.extractLow)})`,
  });

  // Write JSON summary for later inspection
  const fs = await import("fs/promises");
  await fs.writeFile(
    "storage/match-test-batch-summary.json",
    JSON.stringify({ at: new Date().toISOString(), global, perStudent }, null, 2)
  );
  console.log("Wrote storage/match-test-batch-summary.json");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
