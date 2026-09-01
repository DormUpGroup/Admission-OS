/**
 * Baseline F–J: forceRefresh live match + telemetry JSON.
 * Run: npx tsx scripts/run-match-batch2.ts
 */
import { PrismaClient } from "@prisma/client";
import { QUESTIONNAIRE_DIRECTION_MIUR } from "../src/lib/program-directions";
import { getProgramDossier } from "../src/server/services/program-matching/program-dossier";
import {
  buildMatchingProfile,
  persistProgramMatches,
} from "../src/server/services/program-matching/program-matching";

const prisma = new PrismaClient();

const EMAILS = [
  "match-test-f@student.local",
  "match-test-g@student.local",
  "match-test-h@student.local",
  "match-test-i@student.local",
  "match-test-j@student.local",
];

function cityHit(city: string | null | undefined, preferred: string[]): boolean {
  if (!city || preferred.length === 0) return false;
  const c = city.toLowerCase();
  return preferred.some((p) => {
    const n = p.toLowerCase();
    if (n === "вся италия") return false;
    return c.includes(n) || n.includes(c);
  });
}

async function main() {
  const results = [];

  for (const email of EMAILS) {
    const student = await prisma.student.findUnique({ where: { email } });
    if (!student) {
      results.push({ email, error: "not found" });
      continue;
    }

    const programs = student.questionnaireProgramsJson
      ? JSON.parse(student.questionnaireProgramsJson)
      : {};
    const dirs: string[] = Array.isArray(programs.preferredDirections)
      ? programs.preferredDirections
      : [];
    const preferredCities: string[] = Array.isArray(programs.preferredCities)
      ? programs.preferredCities.map(String)
      : [];
    const miur = dirs.map((d) => ({
      direction: d,
      bachelor: QUESTIONNAIRE_DIRECTION_MIUR[d]?.bachelor ?? [],
      master: QUESTIONNAIRE_DIRECTION_MIUR[d]?.master ?? [],
      singleCycle: QUESTIONNAIRE_DIRECTION_MIUR[d]?.singleCycle ?? [],
    }));

    const profile = await buildMatchingProfile(student.id);
    const persisted = await persistProgramMatches(student.id, {
      forceRefresh: true,
    });
    const live = persisted.liveMeta;
    const top20 = persisted.matches.slice(0, 20);
    const cityHits = top20.filter((m) => cityHit(m.city, preferredCities)).length;

    const eligibility: Record<string, number> = {};
    for (const m of persisted.matches) {
      eligibility[m.eligibilityStatus] =
        (eligibility[m.eligibilityStatus] ?? 0) + 1;
    }

    const fill = {
      n: 0,
      call: 0,
      access: 0,
      tuition: 0,
      seats: 0,
      exams: 0,
    };
    for (const m of persisted.matches) {
      const dossier = await getProgramDossier(m.programAcademicYearId);
      fill.n += 1;
      if (!dossier) continue;
      if (dossier.admissionCallUrl || dossier.callFreshness === "current") {
        fill.call += 1;
      }
      if (dossier.accessMode === "OPEN" || dossier.accessMode === "CLOSED") {
        fill.access += 1;
      }
      if (
        dossier.tuitionMin != null ||
        dossier.tuitionMax != null ||
        dossier.tuitionFixed != null
      ) {
        fill.tuition += 1;
      }
      if (dossier.nonEuSeats != null) fill.seats += 1;
      if (dossier.examsDisplay) fill.exams += 1;
    }

    const mapRow = (m: (typeof persisted.matches)[number]) => ({
      status: m.eligibilityStatus,
      fit: m.fitScore,
      university: m.universityName,
      program: m.programName,
      city: m.city,
      year: m.academicYear,
      degreeClass: m.degreeClass,
      whyIncluded: m.discoveryMeta.whyIncluded,
      inclusionKind: m.discoveryMeta.inclusion.kind,
    });

    results.push({
      email,
      name: `${student.firstName} ${student.lastName}`,
      questionnaire: {
        level: programs.studyLevelPlan,
        language: programs.studyLanguage,
        directions: dirs,
        cities: preferredCities,
        english: programs.englishLevel,
        miur,
      },
      profile: {
        degree: profile?.desiredDegreeLevel,
        fields: profile?.fieldsOfInterest,
        langs: profile?.preferredTeachingLanguages,
        missing: profile?.missingFields,
      },
      live: {
        source: live?.source,
        candidates: live?.candidateCount,
        rawCount: live?.rawCount ?? null,
        afterCityFilter: live?.afterCityFilterCount ?? null,
        afterSoftGate: live?.afterSoftGateCount ?? live?.relevantBeforeSynonym ?? null,
        afterSynonym: live?.afterSynonymCount ?? live?.relevantAfterSynonym ?? null,
        warning: live?.warning,
        usedSynonymFallback: live?.usedSynonymFallback,
        directionsSearched: live?.directionsSearched,
        coverageQueried: live?.coverage?.queried ?? [],
        coverageDeferred: live?.coverage?.deferred ?? [],
      },
      matchCount: persisted.matches.length,
      eligibility,
      needsReviewCount: eligibility.NEEDS_REVIEW ?? 0,
      preferredCityShareTop20:
        top20.length === 0 ? null : Math.round((cityHits / top20.length) * 100),
      preferredCityHitsTop20: cityHits,
      fill,
      preGateTop20: live?.preGateSample ?? [],
      postGateTop20: live?.postGateSample ?? [],
      top: top20.map(mapRow),
    });

    console.log(
      `\n=== ${email} raw=${live?.rawCount} city=${live?.afterCityFilterCount} gate=${live?.afterSoftGateCount} syn=${live?.afterSynonymCount} matches=${persisted.matches.length} NEEDS_REVIEW=${eligibility.NEEDS_REVIEW ?? 0} cityShare=${cityHits}/${top20.length} ===`
    );
    for (const m of top20.slice(0, 8)) {
      console.log(
        `- [${m.eligibilityStatus}] ${m.fitScore} ${m.degreeClass ?? "?"} ${m.universityName} / ${m.programName} (${m.discoveryMeta.inclusion.kind})`
      );
    }
  }

  const outPath = "scripts/match-batch2-results.json";
  const fs = await import("fs");
  fs.writeFileSync(
    outPath,
    JSON.stringify({ at: new Date().toISOString(), engine: "v1.6", results }, null, 2),
    "utf8"
  );
  console.log("\nWrote", outPath);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
