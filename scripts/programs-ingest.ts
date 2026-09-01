import { PrismaClient } from "@prisma/client";
import { TARGET_ACADEMIC_YEARS } from "../src/lib/program-matching/config";
import { ingestAllCatalog } from "../src/server/services/program-ingestion/ingest";

const prisma = new PrismaClient();

async function main() {
  const yearArg = process.argv.find((a) => a.startsWith("--year="));
  const years = yearArg
    ? [yearArg.split("=")[1]]
    : [...TARGET_ACADEMIC_YEARS];

  console.log("Ingesting catalogue for", years.join(", "));
  const results = await ingestAllCatalog(years);
  console.log(`Upserted ${results.length} programme-year records`);

  const counts = await Promise.all([
    prisma.university.count(),
    prisma.program.count(),
    prisma.programAcademicYear.count(),
    prisma.sourceDocument.count(),
    prisma.programFact.count(),
  ]);
  console.log({
    universities: counts[0],
    programs: counts[1],
    academicYears: counts[2],
    sources: counts[3],
    facts: counts[4],
  });
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
