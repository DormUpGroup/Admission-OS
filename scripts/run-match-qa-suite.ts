/**
 * Live match all QA suite profiles (32+).
 * Run: npx tsx scripts/run-match-qa-suite.ts
 */
import { writeFileSync } from "fs";
import path from "path";
import { PrismaClient } from "@prisma/client";
import { MATCHING_ENGINE_VERSION, PARSER_VERSION } from "../src/lib/program-matching/config";
import { persistProgramMatches } from "../src/server/services/program-matching/program-matching";
import { QA_SUITE_EMAILS } from "./qa-suite-emails";

const prisma = new PrismaClient();

async function main() {
  const results: Array<Record<string, unknown>> = [];
  for (const email of QA_SUITE_EMAILS) {
    const student = await prisma.student.findUnique({ where: { email } });
    if (!student) {
      results.push({ email, error: "not_found" });
      console.warn("Missing:", email);
      continue;
    }
    console.log("Matching:", email);
    const persisted = await persistProgramMatches(student.id, { forceRefresh: true });
    results.push({
      email,
      matchCount: persisted.matches.length,
      liveMeta: persisted.liveMeta,
    });
  }
  const out = {
    generatedAt: new Date().toISOString(),
    engine: MATCHING_ENGINE_VERSION,
    parser: PARSER_VERSION,
    profiles: QA_SUITE_EMAILS.length,
    results,
  };
  const outPath = path.join(process.cwd(), "scripts", "match-qa-suite-results.json");
  writeFileSync(outPath, JSON.stringify(out, null, 2));
  console.log("Wrote", outPath);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
