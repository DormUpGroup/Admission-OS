import { PrismaClient } from "@prisma/client";
import { PROGRAM_DOSSIER_TTL_DAYS } from "../src/lib/program-matching/config";
import { deepEnrichProgram } from "../src/server/services/program-ingestion/program-deep-enrich";

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
  const staleBefore = new Date(
    Date.now() - PROGRAM_DOSSIER_TTL_DAYS * 24 * 60 * 60 * 1000
  );

  console.log(`Enriching up to ${limit} program dossiers…`);

  const candidates = await prisma.programAcademicYear.findMany({
    where: {
      program: { officialUrl: { not: null } },
      OR: [
        { dossierEnrichedAt: null },
        { dossierEnrichedAt: { lt: staleBefore } },
        {
          facts: {
            none: { sourceType: "ADMISSION_CALL", superseded: false },
          },
        },
      ],
    },
    select: { id: true, academicYear: true, program: { select: { name: true } } },
    orderBy: { lastUpdatedAt: "asc" },
    take: limit,
  });

  let ok = 0;
  let fail = 0;
  for (const c of candidates) {
    const result = await deepEnrichProgram(c.id);
    const label = `${c.program.name} (${c.academicYear})`;
    if (result.ok) {
      ok += 1;
      console.log(`OK  ${label}${result.reason ? ` [${result.reason}]` : ""}`);
    } else {
      fail += 1;
      console.log(`FAIL ${label}: ${result.reason ?? "unknown"}`);
    }
  }

  console.log(`Done. ok=${ok} fail=${fail} scanned=${candidates.length}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
