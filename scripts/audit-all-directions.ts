/**
 * Audit all questionnaire directions: MIUR catalog + live Universitaly coverage.
 * Dedupes by classe code so each tipoClasse is fetched once.
 *
 * npx tsx scripts/audit-all-directions.ts
 */
import { writeFileSync } from "fs";
import {
  PROGRAM_DIRECTIONS,
  type MiurClasseByLevel,
} from "../src/lib/program-directions";
import { resolveClasseId } from "../src/server/services/program-matching/miur-classi";
import { searchCorsi } from "../src/server/services/program-ingestion/universitaly-client";

type LevelKey = "bachelor" | "master" | "singleCycle";

type ClasseLive = {
  code: string;
  id: number | null;
  en3: number | null;
  en2: number | null;
  it3: number | null;
  it2: number | null;
  sampleEn?: string[];
  error?: string;
};

function codesFor(miur: MiurClasseByLevel, level: LevelKey): string[] {
  if (level === "bachelor") {
    return miur.bachelor.length ? miur.bachelor : miur.singleCycle ?? [];
  }
  if (level === "master") {
    return miur.master.length ? miur.master : miur.singleCycle ?? [];
  }
  return miur.singleCycle ?? [];
}

async function liveCount(
  tipoClasse: number,
  lingua: "EN" | "IT",
  durata: string
): Promise<{ total: number; names: string[] }> {
  const r = await searchCorsi(
    {
      lingua,
      durata,
      tipoClasse,
      order: "ASC",
      searchType: "u",
    },
    { maxPages: 1 }
  );
  return {
    total: r.totalResults,
    names: r.corsi.slice(0, 3).map((c) => c.nomeCorso ?? "?"),
  };
}

async function main() {
  const uniqueCodes = new Set<string>();
  for (const d of PROGRAM_DIRECTIONS) {
    for (const c of [
      ...d.miur.bachelor,
      ...d.miur.master,
      ...(d.miur.singleCycle ?? []),
    ]) {
      uniqueCodes.add(c);
    }
  }

  console.log(
    `Directions: ${PROGRAM_DIRECTIONS.length}; unique MIUR codes: ${uniqueCodes.size}`
  );

  const classeLive = new Map<string, ClasseLive>();

  let i = 0;
  for (const code of [...uniqueCodes].sort()) {
    i++;
    const id = await resolveClasseId(code);
    const row: ClasseLive = {
      code,
      id,
      en3: null,
      en2: null,
      it3: null,
      it2: null,
    };
    if (id == null) {
      row.error = "unresolved";
      classeLive.set(code, row);
      console.log(`[${i}/${uniqueCodes.size}] ${code} UNRESOLVED`);
      continue;
    }
    try {
      // Probe EN/IT × bachelor(3)/master(2) — one page each for totals
      const en3 = await liveCount(id, "EN", "3");
      const en2 = await liveCount(id, "EN", "2");
      const it3 = await liveCount(id, "IT", "3");
      const it2 = await liveCount(id, "IT", "2");
      row.en3 = en3.total;
      row.en2 = en2.total;
      row.it3 = it3.total;
      row.it2 = it2.total;
      row.sampleEn = en3.names.length ? en3.names : en2.names;
      console.log(
        `[${i}/${uniqueCodes.size}] ${code} id=${id} EN3=${en3.total} EN2=${en2.total} IT3=${it3.total} IT2=${it2.total}`
      );
    } catch (e) {
      row.error = e instanceof Error ? e.message : String(e);
      console.log(`[${i}/${uniqueCodes.size}] ${code} ERROR ${row.error}`);
    }
    classeLive.set(code, row);
  }

  type DirReport = {
    label: string;
    bachelorCodes: string[];
    masterCodes: string[];
    singleCycleCodes: string[];
    unresolvedCodes: string[];
    bachelorEn: number;
    bachelorIt: number;
    masterEn: number;
    masterIt: number;
    bachelorEnEmpty: boolean;
    masterEnEmpty: boolean;
    issues: string[];
  };

  const directionReports: DirReport[] = [];

  for (const d of PROGRAM_DIRECTIONS) {
    const bachelorCodes = codesFor(d.miur, "bachelor");
    const masterCodes = codesFor(d.miur, "master");
    const singleCycleCodes = d.miur.singleCycle ?? [];
    const all = [...bachelorCodes, ...masterCodes, ...singleCycleCodes];
    const unresolvedCodes = all.filter(
      (c) => classeLive.get(c)?.id == null || classeLive.get(c)?.error === "unresolved"
    );

    const sum = (codes: string[], field: keyof ClasseLive) =>
      codes.reduce((acc, c) => {
        const v = classeLive.get(c)?.[field];
        return acc + (typeof v === "number" ? v : 0);
      }, 0);

    const bachelorEn = sum(bachelorCodes, "en3");
    const bachelorIt = sum(bachelorCodes, "it3");
    const masterEn = sum(masterCodes, "en2");
    const masterIt = sum(masterCodes, "it2");

    const issues: string[] = [];
    if (unresolvedCodes.length) issues.push(`unresolved:${unresolvedCodes.join(",")}`);
    if (bachelorCodes.length === 0 && singleCycleCodes.length === 0)
      issues.push("no-bachelor-or-sc");
    if (bachelorCodes.length && bachelorEn === 0) issues.push("bachelor-EN-empty");
    if (masterCodes.length && masterEn === 0) issues.push("master-EN-empty");
    if (bachelorCodes.length && bachelorIt === 0) issues.push("bachelor-IT-empty");
    if (bachelorCodes.length === 1 && !singleCycleCodes.length)
      issues.push("single-bachelor-code");

    directionReports.push({
      label: d.label,
      bachelorCodes,
      masterCodes,
      singleCycleCodes,
      unresolvedCodes,
      bachelorEn,
      bachelorIt,
      masterEn,
      masterIt,
      bachelorEnEmpty: bachelorCodes.length > 0 && bachelorEn === 0,
      masterEnEmpty: masterCodes.length > 0 && masterEn === 0,
      issues,
    });
  }

  const withIssues = directionReports.filter((r) => r.issues.length > 0);
  const bachelorEnEmpty = directionReports.filter((r) => r.bachelorEnEmpty);
  const masterEnEmpty = directionReports.filter((r) => r.masterEnEmpty);
  const healthyEnBachelor = directionReports.filter(
    (r) => r.bachelorCodes.length > 0 && r.bachelorEn >= 5
  );
  const healthyEnMaster = directionReports.filter(
    (r) => r.masterCodes.length > 0 && r.masterEn >= 5
  );

  // Shared-code collision: codes used by many directions
  const codeOwners = new Map<string, string[]>();
  for (const d of PROGRAM_DIRECTIONS) {
    for (const c of new Set([
      ...d.miur.bachelor,
      ...d.miur.master,
      ...(d.miur.singleCycle ?? []),
    ])) {
      const list = codeOwners.get(c) ?? [];
      list.push(d.label);
      codeOwners.set(c, list);
    }
  }
  const hotCodes = [...codeOwners.entries()]
    .filter(([, owners]) => owners.length >= 4)
    .sort((a, b) => b[1].length - a[1].length)
    .slice(0, 15)
    .map(([code, owners]) => ({
      code,
      owners: owners.length,
      sample: owners.slice(0, 5),
      live: classeLive.get(code),
    }));

  const summary = {
    generatedAt: new Date().toISOString(),
    directions: PROGRAM_DIRECTIONS.length,
    uniqueMiurCodes: uniqueCodes.size,
    unresolvedCodes: [...classeLive.values()].filter((c) => c.id == null).map((c) => c.code),
    counts: {
      directionsWithIssues: withIssues.length,
      bachelorEnEmpty: bachelorEnEmpty.length,
      masterEnEmpty: masterEnEmpty.length,
      healthyEnBachelorGe5: healthyEnBachelor.length,
      healthyEnMasterGe5: healthyEnMaster.length,
    },
    bachelorEnEmpty: bachelorEnEmpty.map((r) => ({
      label: r.label,
      codes: r.bachelorCodes,
      it3: r.bachelorIt,
    })),
    masterEnEmpty: masterEnEmpty.map((r) => ({
      label: r.label,
      codes: r.masterCodes,
      it2: r.masterIt,
    })),
    hotSharedCodes: hotCodes,
    worstBachelorEn: [...directionReports]
      .filter((r) => r.bachelorCodes.length)
      .sort((a, b) => a.bachelorEn - b.bachelorEn)
      .slice(0, 15)
      .map((r) => ({
        label: r.label,
        en: r.bachelorEn,
        it: r.bachelorIt,
        codes: r.bachelorCodes,
      })),
    bestBachelorEn: [...directionReports]
      .filter((r) => r.bachelorCodes.length)
      .sort((a, b) => b.bachelorEn - a.bachelorEn)
      .slice(0, 10)
      .map((r) => ({
        label: r.label,
        en: r.bachelorEn,
        codes: r.bachelorCodes,
      })),
    directionReports,
    classeLive: Object.fromEntries(classeLive),
  };

  writeFileSync(
    "scripts/audit-all-directions-results.json",
    JSON.stringify(summary, null, 2),
    "utf8"
  );

  console.log("\n=== SUMMARY ===");
  console.log(JSON.stringify(summary.counts, null, 2));
  console.log("bachelor EN empty:", summary.bachelorEnEmpty.length);
  console.log(
    summary.bachelorEnEmpty
      .slice(0, 20)
      .map((x) => `- ${x.label} [${x.codes.join(",")}] IT=${x.it3}`)
      .join("\n")
  );
  console.log("\nWrote scripts/audit-all-directions-results.json");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
