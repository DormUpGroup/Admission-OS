/**
 * Evaluate golden bando fixtures → storage/bando-eval-latest.json
 * Run: npm run bando:eval
 */
import { copyFile, mkdir, writeFile } from "fs/promises";
import { existsSync } from "fs";
import path from "path";
import {
  aggregateFieldPrecision,
  evaluateParsed,
  loadBandoFixtures,
} from "../src/server/services/program-ingestion/bando-eval";
import { parseCallText } from "../src/server/services/program-ingestion/call-text-parse";

async function main() {
  const fixtures = loadBandoFixtures().filter(
    (f) => f.id !== "discover-tasse-html"
  );
  const perFixture = fixtures.map((f) => {
    const parsed = parseCallText(f.source, `https://example.it/${f.id}`, {
      academicYear: f.academicYear,
    });
    const checks = evaluateParsed(parsed, f.expected);
    const failed = Object.entries(checks)
      .filter(([, c]) => !c.ok)
      .map(([k, c]) => `${k}:${c.detail}`);
    return { id: f.id, ok: failed.length === 0, failed };
  });

  const fields = aggregateFieldPrecision(fixtures);
  const summary = {
    at: new Date().toISOString(),
    n: fixtures.length,
    passed: perFixture.filter((p) => p.ok).length,
    fields: Object.fromEntries(
      Object.entries(fields).map(([k, v]) => [
        k,
        {
          p: Math.round(v.precision * 1000) / 1000,
          r: Math.round(v.recall * 1000) / 1000,
          tp: v.tp,
          fp: v.fp,
          fn: v.fn,
        },
      ])
    ),
    perFixture,
  };

  const outDir = path.join(process.cwd(), "storage");
  await mkdir(outDir, { recursive: true });
  const outPath = path.join(outDir, "bando-eval-latest.json");
  const prevPath = path.join(outDir, "bando-eval-previous.json");
  if (existsSync(outPath)) {
    await copyFile(outPath, prevPath);
  }
  await writeFile(outPath, JSON.stringify(summary, null, 2));
  console.log(JSON.stringify(summary, null, 2));
  console.log("Wrote", outPath);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
