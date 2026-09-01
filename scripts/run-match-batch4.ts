/**
 * Live match P–Y (batch4, 10 students) + precision scoring.
 * Run: npx tsx scripts/run-match-batch4.ts
 */
import { PrismaClient } from "@prisma/client";
import { MATCHING_ENGINE_VERSION } from "../src/lib/program-matching/config";
import { QUESTIONNAIRE_DIRECTION_MIUR } from "../src/lib/program-directions";
import { getProgramDossier } from "../src/server/services/program-matching/program-dossier";
import {
  buildMatchingProfile,
  persistProgramMatches,
} from "../src/server/services/program-matching/program-matching";

const prisma = new PrismaClient();

const EMAILS = [
  "match-test-p@student.local",
  "match-test-q@student.local",
  "match-test-r@student.local",
  "match-test-s@student.local",
  "match-test-t@student.local",
  "match-test-u@student.local",
  "match-test-v@student.local",
  "match-test-w@student.local",
  "match-test-x@student.local",
  "match-test-y@student.local",
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
  mixType: "single" | "multi";
  goodKeywords: string[];
  badKeywords: string[];
  expectedClasses: string[];
};

const PRECISION: Record<string, PrecisionSpec> = {
  "match-test-p@student.local": {
    label: "Architecture",
    mixType: "single",
    goodKeywords: [
      "architect",
      "building",
      "urban",
      "landscape",
      "heritage",
      "construction",
      "sustainable",
      "engineering",
    ],
    badKeywords: ["econom", "psych", "biolog", "informatic"],
    expectedClasses: ["L-17", "L-23", "L-7"],
  },
  "match-test-q@student.local": {
    label: "Economics + Finance",
    mixType: "multi",
    goodKeywords: ["econom", "finance", "business", "management", "commercial"],
    badKeywords: ["informatic", "computer science", "biolog", "psych", "architect"],
    expectedClasses: ["L-33", "L-18", "L-35"],
  },
  "match-test-r@student.local": {
    label: "CompEng + IT Security",
    mixType: "multi",
    goodKeywords: [
      "computer",
      "engineering",
      "cyber",
      "security",
      "electronic",
      "informatic",
      "software",
    ],
    badKeywords: ["econom", "psych", "biolog", "philolog", "design"],
    expectedClasses: ["L-8", "L-31", "L-9"],
  },
  "match-test-s@student.local": {
    label: "International Relations",
    mixType: "single",
    goodKeywords: [
      "international",
      "relations",
      "political",
      "global",
      "diplomacy",
      "affairs",
    ],
    badKeywords: ["engineering", "biolog", "informatic", "architect"],
    expectedClasses: ["L-36", "L-37", "L-16"],
  },
  "match-test-t@student.local": {
    label: "Psychology + Cognitive",
    mixType: "multi",
    goodKeywords: [
      "psych",
      "psicolog",
      "cognitive",
      "neuro",
      "behavior",
      "biolog",
    ],
    badKeywords: ["econom", "informatic", "civil eng", "architect"],
    expectedClasses: ["L-24", "L-13"],
  },
  "match-test-u@student.local": {
    label: "Mathematics",
    mixType: "single",
    goodKeywords: ["math", "mathematic", "statistic", "quantitative"],
    badKeywords: ["psych", "design", "architect", "medicina"],
    expectedClasses: ["L-35", "L-40", "L-30"],
  },
  "match-test-v@student.local": {
    label: "Biology + Biotech",
    mixType: "multi",
    goodKeywords: [
      "biolog",
      "biotech",
      "genom",
      "molecular",
      "industrial biotech",
    ],
    badKeywords: ["econom", "psych", "architect", "international relation"],
    expectedClasses: ["L-13", "L-2", "L-25"],
  },
  "match-test-w@student.local": {
    label: "Civil Engineering (Master)",
    mixType: "multi",
    goodKeywords: [
      "civil",
      "structural",
      "construction",
      "building",
      "infrastructure",
      "geotechn",
    ],
    badKeywords: ["econom", "psych", "philolog", "design", "biolog"],
    expectedClasses: ["LM-23", "LM-24", "LM-35", "L-7"],
  },
  "match-test-x@student.local": {
    label: "Philology + Linguistics (IT)",
    mixType: "multi",
    goodKeywords: [
      "philolog",
      "linguist",
      "letter",
      "language",
      "literature",
      "humanities",
    ],
    badKeywords: ["engineering", "econom", "biolog", "informatic"],
    expectedClasses: ["L-10", "L-11", "L-12"],
  },
  "match-test-y@student.local": {
    label: "Economics + CS (stress mix)",
    mixType: "multi",
    goodKeywords: [
      "econom",
      "finance",
      "business",
      "informatic",
      "computer",
      "data science",
      "software",
    ],
    badKeywords: ["psych", "medicina", "veterinar", "architect", "biolog"],
    expectedClasses: ["L-33", "L-18", "L-31", "L-8"],
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
  const secondaryInTop5 = top5.filter(
    (r) => r.inclusionKind === "secondary_classe"
  ).length;
  const noiseInTop5 = scores.filter((r) => r.score === 0).length;
  return { avgTop5, exactInTop5, secondaryInTop5, noiseInTop5, scores };
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

    const fill = { n: 0, call: 0, access: 0, tuition: 0, seats: 0, exams: 0 };
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
      mixType: spec.mixType,
      directions: dirs,
      avgTop5: precision.avgTop5,
      exactInTop5: precision.exactInTop5,
      secondaryInTop5: precision.secondaryInTop5,
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
        afterSoftGate: live?.afterSoftGateCount ?? null,
        warning: live?.warning,
        usedSynonymFallback: live?.usedSynonymFallback,
        thinPoolRetry: live?.thinPoolRetry ?? false,
        coverageDeferred: live?.coverage?.deferred ?? [],
      },
      matchCount: persisted.matches.length,
      eligibility,
      needsReviewCount: eligibility.NEEDS_REVIEW ?? 0,
      preferredCityShareTop20:
        top20.length === 0 ? null : Math.round((cityHits / top20.length) * 100),
      precision,
      fill,
      top,
    });

    console.log(
      `\n=== ${email} [${spec.mixType}] ${spec.label} precision=${precision.avgTop5}/100 matches=${persisted.matches.length} ===`
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
  const single = precisionSummary.filter((r) => r.mixType === "single");
  const multi = precisionSummary.filter((r) => r.mixType === "multi");
  const avgSingle =
    single.length === 0
      ? null
      : Math.round(single.reduce((s, r) => s + r.avgTop5, 0) / single.length);
  const avgMulti =
    multi.length === 0
      ? null
      : Math.round(multi.reduce((s, r) => s + r.avgTop5, 0) / multi.length);

  const outPath = "scripts/match-batch4-results.json";
  const fs = await import("fs");
  fs.writeFileSync(
    outPath,
    JSON.stringify(
      {
        at: new Date().toISOString(),
        engine: MATCHING_ENGINE_VERSION,
        overallPrecisionTop5: overall,
        avgSingleSphere: avgSingle,
        avgMultiSphere: avgMulti,
        precisionSummary,
        results,
      },
      null,
      2
    ),
    "utf8"
  );

  console.log("\n=== BATCH4 OVERALL:", overall, "/ 100 ===");
  console.log("Single-sphere avg:", avgSingle, "| Multi-sphere avg:", avgMulti);
  console.log("Wrote", outPath);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
