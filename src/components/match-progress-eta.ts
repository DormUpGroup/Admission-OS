import type { MatchProgressStage } from "@/server/services/program-matching/program-matching";

/** Wall-time weights; enrichment dominates Generate. */
const STAGE_WEIGHTS: Record<MatchProgressStage, number> = {
  profile: 0.02,
  universitaly: 0.12,
  score: 0.04,
  documents: 0.02,
  ai_extract: 0.7,
  enrich: 0.7,
  rank: 0.05,
  save: 0.05,
  done: 0,
};

const STAGE_ORDER: MatchProgressStage[] = [
  "profile",
  "universitaly",
  "score",
  "documents",
  "ai_extract",
  "rank",
  "save",
];

const TAIL_SECONDS = 8;
const EMA_ALPHA = 0.35;

export function formatElapsed(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${r.toString().padStart(2, "0")}`;
}

export function formatEtaLabel(remainingSeconds: number | null): string {
  if (remainingSeconds == null) return "оценка после первой программы";
  if (remainingSeconds <= 8) return "почти готово";
  if (remainingSeconds < 60) return `~${Math.round(remainingSeconds)} сек`;
  const mins = Math.max(1, Math.round(remainingSeconds / 60));
  return `~${mins} мин`;
}

function weightBefore(stage: MatchProgressStage): number {
  let sum = 0;
  for (const id of STAGE_ORDER) {
    if (id === stage) break;
    sum += STAGE_WEIGHTS[id] ?? 0;
  }
  return sum;
}

function stageFraction(
  stage: MatchProgressStage,
  percent: number,
  done?: number,
  total?: number
): number {
  if (
    (stage === "ai_extract" || stage === "enrich") &&
    total != null &&
    total > 0 &&
    done != null
  ) {
    return Math.min(1, Math.max(0, done / total));
  }
  // Map overall percent into 0..1 within current stage band.
  const bands: Partial<Record<MatchProgressStage, [number, number]>> = {
    profile: [0, 3],
    universitaly: [3, 20],
    score: [20, 25],
    documents: [25, 28],
    ai_extract: [28, 88],
    enrich: [28, 88],
    rank: [88, 92],
    save: [92, 97],
  };
  const [lo, hi] = bands[stage] ?? [0, 100];
  if (hi <= lo) return 0;
  return Math.min(1, Math.max(0, (percent - lo) / (hi - lo)));
}

export function estimateRemainingSeconds(input: {
  stage: MatchProgressStage;
  percent: number;
  elapsedSeconds: number;
  elapsedInStageSeconds: number;
  done?: number;
  total?: number;
}): number | null {
  const { stage, percent, elapsedSeconds, elapsedInStageSeconds, done, total } =
    input;

  if (stage === "done") return 0;

  if (
    (stage === "ai_extract" || stage === "enrich") &&
    total != null &&
    total > 0
  ) {
    if (done == null || done <= 0) return null;
    const remainingItems = Math.max(0, total - done);
    const perItem = elapsedInStageSeconds / done;
    return remainingItems * perItem + TAIL_SECONDS;
  }

  if (elapsedSeconds < 2) return null;

  const before = weightBefore(stage);
  const weight = STAGE_WEIGHTS[stage] ?? 0.1;
  const frac = stageFraction(stage, percent, done, total);
  const progressWeight = before + weight * frac;
  if (progressWeight <= 0.01) return null;

  const estimatedTotal = elapsedSeconds / progressWeight;
  return Math.max(0, estimatedTotal - elapsedSeconds);
}

export function smoothEta(
  previous: number | null,
  next: number | null
): number | null {
  if (next == null) return previous;
  if (previous == null) return next;
  return previous * (1 - EMA_ALPHA) + next * EMA_ALPHA;
}
