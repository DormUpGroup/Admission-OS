import { readdirSync, readFileSync, existsSync } from "fs";
import path from "path";
import { parseCallText, type CallTextParse } from "./call-text-parse";

export type BandoExpected = {
  tuitionMin?: number | null;
  tuitionMax?: number | null;
  accessMode?: "OPEN" | "CLOSED" | "UNKNOWN";
  selection?: "NONE" | "EVALUATION" | "ENTRANCE_EXAM" | "UNKNOWN";
  nonEuSeats?: number | null;
  exams?: string[];
  examAlternatives?: string[];
  deadlines?: string[];
  languageLevel?: string | null;
  careerOutcomesContains?: string;
  quality?: "OK" | "LOW" | "EMPTY";
};

export type BandoFixture = {
  id: string;
  dir: string;
  academicYear?: string;
  note?: string;
  source: string;
  expected: BandoExpected;
};

export function fixturesRoot(): string {
  return path.join(process.cwd(), "tests", "fixtures", "bando");
}

export function loadBandoFixtures(): BandoFixture[] {
  const root = fixturesRoot();
  if (!existsSync(root)) return [];
  const ids = readdirSync(root, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort();

  const out: BandoFixture[] = [];
  for (const id of ids) {
    const dir = path.join(root, id);
    const sourcePath = existsSync(path.join(dir, "source.html"))
      ? path.join(dir, "source.html")
      : path.join(dir, "source.txt");
    if (!existsSync(sourcePath)) continue;
    const expectedPath = path.join(dir, "expected.json");
    const metaPath = path.join(dir, "meta.json");
    const expected = JSON.parse(
      readFileSync(expectedPath, "utf8")
    ) as BandoExpected;
    const meta = existsSync(metaPath)
      ? (JSON.parse(readFileSync(metaPath, "utf8")) as {
          id?: string;
          note?: string;
          academicYear?: string;
        })
      : {};
    out.push({
      id: meta.id || id,
      dir,
      academicYear: meta.academicYear,
      note: meta.note,
      source: readFileSync(sourcePath, "utf8"),
      expected,
    });
  }
  return out;
}

export type FieldEval = {
  tp: number;
  fp: number;
  fn: number;
  precision: number;
  recall: number;
};

function pr(tp: number, fp: number, fn: number): FieldEval {
  const precision = tp + fp === 0 ? 1 : tp / (tp + fp);
  const recall = tp + fn === 0 ? 1 : tp / (tp + fn);
  return { tp, fp, fn, precision, recall };
}

export function evaluateParsed(
  parsed: CallTextParse,
  expected: BandoExpected
): Record<string, { ok: boolean; detail?: string }> {
  const checks: Record<string, { ok: boolean; detail?: string }> = {};

  if (expected.quality != null) {
    checks.quality = {
      ok: parsed.quality === expected.quality,
      detail: `${parsed.quality} vs ${expected.quality}`,
    };
  }
  if (expected.tuitionMin != null) {
    checks.tuitionMin = {
      ok: parsed.tuitionMin?.value === expected.tuitionMin,
      detail: `${parsed.tuitionMin?.value ?? null}`,
    };
  }
  if (expected.tuitionMax != null) {
    checks.tuitionMax = {
      ok: parsed.tuitionMax?.value === expected.tuitionMax,
      detail: `${parsed.tuitionMax?.value ?? null}`,
    };
  }
  if (expected.accessMode != null) {
    checks.accessMode = {
      ok: parsed.accessMode.value === expected.accessMode,
      detail: parsed.accessMode.value,
    };
  }
  if (expected.selection != null) {
    checks.selection = {
      ok: parsed.admissionRegime.selection.value === expected.selection,
      detail: parsed.admissionRegime.selection.value,
    };
  }
  if (expected.nonEuSeats != null) {
    checks.nonEuSeats = {
      ok: parsed.nonEuSeats?.value === expected.nonEuSeats,
      detail: `${parsed.nonEuSeats?.value ?? null}`,
    };
  }
  if (expected.languageLevel != null) {
    checks.languageLevel = {
      ok: parsed.languageLevel?.value === expected.languageLevel,
      detail: parsed.languageLevel?.value ?? undefined,
    };
  }
  if (expected.exams?.length) {
    const names = parsed.exams.map((e) => e.name.toUpperCase());
    const missing = expected.exams.filter(
      (e) => !names.some((n) => n.includes(e.toUpperCase()) || e.toUpperCase().includes(n))
    );
    checks.exams = { ok: missing.length === 0, detail: names.join(",") };
  }
  if (expected.examAlternatives?.length) {
    const names = parsed.examAlternatives.map((e) => e.name.toUpperCase());
    const ok = expected.examAlternatives.every((e) =>
      names.some((n) => n.includes(e.toUpperCase()))
    );
    checks.examAlternatives = { ok, detail: names.join(",") };
  }
  if (expected.deadlines?.length) {
    const got = parsed.deadlines.map((d) => d.value);
    const ok = expected.deadlines.some((d) =>
      got.some((g) => g.includes(d) || d.includes(g))
    );
    checks.deadlines = { ok, detail: got.join("|") };
  }
  if (expected.careerOutcomesContains) {
    const text = parsed.careerOutcomes?.value || "";
    checks.career = {
      ok: text.toLowerCase().includes(expected.careerOutcomesContains.toLowerCase()),
      detail: text.slice(0, 80),
    };
  }
  return checks;
}

export function aggregateFieldPrecision(
  fixtures: BandoFixture[]
): Record<string, FieldEval> {
  const buckets: Record<string, { tp: number; fp: number; fn: number }> = {};
  const bump = (field: string, kind: "tp" | "fp" | "fn") => {
    if (!buckets[field]) buckets[field] = { tp: 0, fp: 0, fn: 0 };
    buckets[field][kind] += 1;
  };

  for (const f of fixtures) {
    const parsed = parseCallText(f.source, `https://example.it/bando/${f.id}`, {
      academicYear: f.academicYear,
    });
    const checks = evaluateParsed(parsed, f.expected);
    for (const [field, c] of Object.entries(checks)) {
      if (c.ok) bump(field, "tp");
      else {
        // If expected set a value and we missed → fn; if we produced wrong → fp+fn-ish
        bump(field, "fn");
        bump(field, "fp");
      }
    }
  }

  const out: Record<string, FieldEval> = {};
  for (const [k, v] of Object.entries(buckets)) {
    out[k] = pr(v.tp, v.fp, v.fn);
  }
  return out;
}
