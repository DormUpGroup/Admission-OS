/**
 * Drop Universitaly-discovered programs; keep the seeded MVP catalog.
 * Run: npx tsx scripts/reset-universitaly-cache.ts
 */
import { PrismaClient } from "@prisma/client";
import { resetUniversitalyCache } from "../src/server/services/program-ingestion/reset-universitaly-cache";

const prisma = new PrismaClient();

async function counts() {
  const [universities, programs, pays, matches, shortlist] = await Promise.all([
    prisma.university.count(),
    prisma.program.count(),
    prisma.programAcademicYear.count(),
    prisma.programMatch.count(),
    prisma.studentShortlistItem.count(),
  ]);
  return { universities, programs, pays, matches, shortlist };
}

async function main() {
  console.log("before", await counts());
  const result = await resetUniversitalyCache();
  if (result.skippedWithApplications.length > 0) {
    console.log(
      "skipped live programs with applications:",
      result.skippedWithApplications
    );
  }
  console.log("deleted", {
    livePrograms: result.liveProgramsDeleted,
    shortlist: result.shortlistDeleted,
    matches: result.matchesDeleted,
    emptyUniversities: result.emptyUniversitiesDeleted,
    searchCacheActivities: result.searchCacheDeleted,
  });
  console.log("after", await counts());
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
