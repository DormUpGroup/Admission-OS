/**
 * Backfill campusCity on Universitaly programs from university name / stored facts.
 * Run: npx tsx scripts/backfill-program-cities.ts
 */
import { PrismaClient } from "@prisma/client";
import { regionForCity } from "../src/lib/program-matching/taxonomy";

const prisma = new PrismaClient();

const CITY_IN_NAME =
  /\b(MILANO|TORINO|BOLOGNA|ROMA|PADOVA|PAVIA|PISA|FIRENZE|GENOVA|NAPOLI|BARI|PALERMO|CATANIA|TRIESTE|VERONA|MODENA|PARMA|SIENA|PERUGIA|MESSINA|BICOCCA)\b/i;

function parseCityFromUniversityName(name: string): string | null {
  const m =
    name.match(/\b(?:di|del|della|dei|delle)\s+([A-Za-zÀ-ÿ'().\s-]{3,40})\s*$/i) ??
    name.match(CITY_IN_NAME);
  if (!m?.[1]) return null;
  const parsed = m[1].trim();
  return parsed.length >= 3 ? parsed : null;
}

async function main() {
  const programs = await prisma.program.findMany({
    where: {
      OR: [{ campusCity: null }, { campusCity: "" }],
      universitalyExternalId: { not: null },
    },
    include: { university: true },
  });

  let updated = 0;
  for (const p of programs) {
    const fromUni = parseCityFromUniversityName(p.university.name);
    const city = fromUni ?? p.university.city;
    if (!city) continue;
    const region = regionForCity(city) ?? p.region ?? p.university.region;
    await prisma.program.update({
      where: { id: p.id },
      data: {
        campusCity: city,
        region: region ?? undefined,
      },
    });
    if (!p.university.city) {
      await prisma.university.update({
        where: { id: p.universityId },
        data: { city, region: region ?? undefined },
      });
    }
    updated += 1;
    console.log("Updated", p.name, "→", city);
  }
  console.log("Done.", updated, "programs updated.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
