/**
 * Live match K–O + precision scoring.
 * Run: npx tsx scripts/run-match-batch3.ts
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
  "match-test-k@student.local",
  "match-test-l@student.local",
  "match-test-m@student.local",
  "match-test-n@student.local",
  "match-test-o@student.local",
];

type MatchRow = {
  status: string;
  fit: number;
  university: string;
  program: string;
  city: string | null;
  year: string;
  degreeClass: string | null;
  whyIncluded: string;
  inclusionKind: string;
};

type PrecisionSpec = {
  label: string;
  goodKeywords: string[];
  badKeywords: string[];
  expectedClasses: string[];
};

const PRECISION: Record<string, PrecisionSpec> = {
  "match-test-k@student.local": {
    label: "Psychology only",
    goodKeywords: [
      "psych",
      "psicolog",
      "behavior",
      "cognitive science",
      "neuroscience",
    ],
    badKeywords: ["biolog", "biotech", "genomic", "econom", "informatic"],
    expectedClasses: ["L-24"],
  },
  "match-test-l@student.local": {
    label: "Computer science only",
    goodKeywords: [
      "informatic",
      "computer",
      "software",
      "data science",
      "artificial intelligence",
      "cyber",
    ],
    badKeywords: ["econom", "business admin", "management", "marketing", "finance"],
    expectedClasses: ["L-31", "L-18"],
  },
  "match-test-m@student.local": {
    label: "Economics only",
    goodKeywords: [
      "econom",
      "business",
      "management",
      "finance",
      "commercial",
    ],
    badKeywords: ["informatic", "computer science", "software", "engineering"],
    expectedClasses: ["L-18", "L-33", "L-35"],
  },
  "match-test-n@student.local": {
    label: "Physics",
    goodKeywords: ["physic", "fisica", "astro", "quantum", "materials science"],
    badKeywords: ["psych", "design", "econom", "medicina"],
    expectedClasses: ["L-30", "L-27"],
  },
  "match-test-o@student.local": {
    label: "Design (IT)",
    goodKeywords: ["design", "disegn", "graphic", "fashion", "industrial design"],
    badKeywords: ["civil eng", "informatic", "econom", "medicina", "physics"],
    expectedClasses: ["L-4", "L-17"],
  },
};

function cityHit(city: string | null | undefined, preferred: string[]): boolean {
  if (!city || preferred.length === 0) return false;
  const c = city.toLowerCase();
  return preferred.some((p) => {
    const n = p.toLowerCase();
    if (n === "вся италия") return false;
    return c.includes(n) || n.includes(c);
  });
}

function haystack(row: MatchRow): string {
  return `${row.program} ${row.university} ${row.degreeClass ?? ""}`.toLowerCase();
}

function scoreRow(row: MatchRow, spec: PrecisionSpec): number {
  const text = haystack(row);
  for (const bad of spec.badKeywords) {
    if (text.includes(bad.toLowerCase())) return 0;
  }

  const goodHit = spec.goodKeywords.some((k) => text.includes(k.toLowerCase()));
  const classHit = spec.expectedClasses.some((c) =>
    (row.degreeClass ?? "").includes(c)
  );
  const kind = row.inclusionKind;

  if (kind === "exact_classe" && (goodHit || classHit)) return 100;
  if (kind === "strong_tag" && goodHit) return 90;
  if (kind === "exact_classe" && classHit) return 80;
  if (kind === "exact_classe") return 70;
  if (kind === "strong_tag") return 65;
  if (kind === "secondary_classe" && goodHit) return 50;
  if (kind === "synonym" && goodHit) return 45;
  if (kind === "secondary_classe") return 25;
  if (goodHit) return 40;
  return 15;
}

function summarizePrecision(top: MatchRow[], spec: PrecisionSpec) {
  const top5 = top.slice(0, 5);
  const scores = top5.map((row) => ({
    program: row.program,
    university: row.university,
    kind: row.inclusionKind,
    degreeClass: row.degreeClass,
    score: scoreRow(row, spec),
  }));
  const avgTop5 =
    scores.length === 0
      ? 0
      : Math.round(scores.reduce((s, r) => s + r.score, 0) / scores.length);
  const exactInTop5 = top5.filter((r) => r.inclusionKind === "exact_classe").length;
  const noiseInTop5 = scores.filter((r) => r.score === 0).length;
  return { avgTop5, exactInTop5, noiseInTop5, scores };
}

async function main() {
  const results = [];
  const precisionSummary = [];

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

    const mapRow = (m: (typeof persisted.matches)[number]): MatchRow => ({
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

    const top = top20.map(mapRow);
    const spec = PRECISION[email];
    const precision = summarizePrecision(top, spec);

    precisionSummary.push({
      email,
      sphere: spec.label,
      avgTop5: precision.avgTop5,
      exactInTop5: precision.exactInTop5,
      noiseInTop5: precision.noiseInTop5,
      top5Detail: precision.scores,
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
      precision,
      fill,
      top,
    });

    console.log(
      `\n=== ${email} (${spec.label}) precision=${precision.avgTop5}/100 noise=${precision.noiseInTop5}/5 ===`
    );
    for (const s of precision.scores) {
      console.log(
        `  [${s.score}] ${s.degreeClass ?? "?"} ${s.kind} — ${s.university} / ${s.program}`
      );
    }
  }

  const overall =
    precisionSummary.length === 0
      ? 0
      : Math.round(
          precisionSummary.reduce((s, r) => s + r.avgTop5, 0) /
            precisionSummary.length
        );

  const outPath = "scripts/match-batch3-results.json";
  const fs = await import("fs");
  fs.writeFileSync(
    outPath,
    JSON.stringify(
      {
        at: new Date().toISOString(),
        engine: "v1.7",
        overallPrecisionTop5: overall,
        precisionSummary,
        results,
      },
      null,
      2
    ),
    "utf8"
  );

  console.log("\n=== OVERALL PRECISION (avg top-5):", overall, "/ 100 ===");
  console.log("Wrote", outPath);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
