/** Run one QA profile for debugging. Usage: npx tsx scripts/run-single-qa-profile.ts match-test-qa-med@student.local */
import { PrismaClient } from "@prisma/client";
import { persistProgramMatches } from "../src/server/services/program-matching/program-matching";

const email = process.argv[2];
if (!email) {
  console.error("Usage: npx tsx scripts/run-single-qa-profile.ts <email>");
  process.exit(1);
}

const prisma = new PrismaClient();

async function main() {
  const student = await prisma.student.findUnique({ where: { email } });
  if (!student) {
    console.error("Missing:", email);
    process.exit(1);
  }
  console.log("Matching:", email);
  const r = await persistProgramMatches(student.id, { forceRefresh: true });
  console.log("OK", r.matches.length, "matches");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
