import { PrismaClient } from "@prisma/client";
import { ingestAllCatalog } from "../src/server/services/program-ingestion/ingest";
import { alertShortlistedOnChange } from "../src/server/services/program-ingestion/snapshot";
import { TARGET_ACADEMIC_YEARS } from "../src/lib/program-matching/config";

const prisma = new PrismaClient();

async function main() {
  console.log("Refreshing programme catalogue…");
  const before = await prisma.sourceDocument.findMany({
    select: { id: true, url: true, contentHash: true, programId: true, programAcademicYearId: true },
  });
  const beforeMap = new Map(before.map((b) => [`${b.url}|${b.programAcademicYearId}`, b]));

  await ingestAllCatalog([...TARGET_ACADEMIC_YEARS]);

  const after = await prisma.sourceDocument.findMany({
    orderBy: { retrievedAt: "desc" },
    take: 500,
  });

  let changed = 0;
  for (const doc of after) {
    const prev = beforeMap.get(`${doc.url}|${doc.programAcademicYearId}`);
    if (prev && prev.contentHash !== doc.contentHash && doc.programId) {
      changed += 1;
      await alertShortlistedOnChange({
        programId: doc.programId,
        programAcademicYearId: doc.programAcademicYearId ?? undefined,
        field: "SOURCE_CONTENT",
        oldValue: prev.contentHash,
        newValue: doc.contentHash,
      });
    }
  }

  console.log(`Refresh complete. Source content changes detected: ${changed}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
