import { PrismaClient } from "@prisma/client";
import { buildMatchingProfile } from "../src/server/services/program-matching/program-matching";
import {
  generateProgramMatches,
  persistProgramMatches,
} from "../src/server/services/program-matching/program-matching";

const prisma = new PrismaClient();

async function main() {
  const arg = process.argv.find((a) => a.startsWith("--student="));
  const emailArg = process.argv.find((a) => a.startsWith("--email="));
  let studentId = arg?.split("=")[1];

  if (!studentId && emailArg) {
    const s = await prisma.student.findUnique({
      where: { email: emailArg.split("=")[1] },
    });
    studentId = s?.id;
  }

  if (!studentId) {
    const s = await prisma.student.findFirst({
      where: { email: "alina.sokolova@student.local" },
    });
    studentId = s?.id;
  }

  if (!studentId) {
    console.error("Student not found. Pass --student=<id> or --email=<email>");
    process.exit(1);
  }

  const profile = await buildMatchingProfile(studentId);
  console.log("MatchingProfile", {
    year: profile?.targetAcademicYear,
    degree: profile?.desiredDegreeLevel,
    fields: profile?.fieldsOfInterest,
    category: profile?.applicantCategory,
    missing: profile?.missingFields,
  });

  const persisted = await persistProgramMatches(studentId);
  console.log(`Persisted ${persisted.matches.length} matches`, {
    source: persisted.liveMeta?.source,
    candidates: persisted.liveMeta?.candidateCount,
    warning: persisted.liveMeta?.warning,
  });
  for (const m of persisted.matches.slice(0, 15)) {
    console.log(
      `- [${m.eligibilityStatus}] ${m.fitScore} ${m.universityName} / ${m.programName} (${m.academicYear})`
    );
  }

  const live = await generateProgramMatches(studentId, {
    limit: 5,
    programAcademicYearIds: persisted.liveMeta?.programAcademicYearIds,
  });
  console.log("Top 5 preview:", live.map((m) => m.programName));
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
