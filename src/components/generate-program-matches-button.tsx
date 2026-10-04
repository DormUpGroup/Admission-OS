"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type {
  MatchProgressEvent,
  MatchProgressStage,
} from "@/server/services/program-matching/program-matching";
import type { ProgramMatchJobView } from "@/server/services/program-matching/match-job";
import {
  estimateRemainingSeconds,
  formatElapsed,
  formatEtaLabel,
  smoothEta,
} from "@/components/match-progress-eta";

const STEPS: { id: MatchProgressStage; label: string }[] = [
  { id: "profile", label: "Профиль анкеты" },
  { id: "universitaly", label: "Поиск на Universitaly" },
  { id: "score", label: "Оценка программ" },
  { id: "documents", label: "Официальные документы" },
  { id: "ai_extract", label: "AI-извлечение" },
  { id: "rank", label: "Ранжирование" },
  { id: "save", label: "Сохранение" },
];

const POLL_MS = 1500;
const PENDING_STALE_SECONDS = 90;

function stepIndex(stage: MatchProgressStage | "complete" | "error" | null) {
  if (!stage || stage === "complete" || stage === "error" || stage === "done") {
    return STEPS.length;
  }
  if (stage === "enrich") {
    return STEPS.findIndex((s) => s.id === "ai_extract");
  }
  return STEPS.findIndex((s) => s.id === stage);
}

function progressFromJob(job: ProgramMatchJobView): MatchProgressEvent {
  return {
    stage: (job.stage as MatchProgressStage) || "profile",
    label: job.label || "Подбор программ…",
    percent: job.percent,
    detail: job.detail ?? undefined,
    done: job.done ?? undefined,
    total: job.total ?? undefined,
  };
}

export function GenerateProgramMatchesButton({
  studentId,
  disabled,
  actions,
}: {
  studentId: string;
  disabled?: boolean;
  actions?: ReactNode;
}) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState<MatchProgressEvent | null>(null);
  const [completeCount, setCompleteCount] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [etaSeconds, setEtaSeconds] = useState<number | null>(null);
  const [workerHint, setWorkerHint] = useState(false);

  const startedAtRef = useRef<number | null>(null);
  const stageStartedAtRef = useRef<number | null>(null);
  const lastStageRef = useRef<MatchProgressStage | null>(null);
  const etaSmoothRef = useRef<number | null>(null);
  const completeCountRef = useRef<number | null>(null);
  const jobIdRef = useRef<string | null>(null);
  const pollTimerRef = useRef<number | null>(null);
  const revealedRef = useRef(false);

  useEffect(() => {
    if (!loading) return;
    const id = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [loading]);

  useEffect(() => {
    if (!loading || !progress || !startedAtRef.current) return;

    if (lastStageRef.current !== progress.stage) {
      lastStageRef.current = progress.stage;
      stageStartedAtRef.current = Date.now();
      etaSmoothRef.current = null;
    }

    const elapsedSeconds =
      (nowMs - (startedAtRef.current ?? nowMs)) / 1000;
    const elapsedInStageSeconds =
      (nowMs - (stageStartedAtRef.current ?? nowMs)) / 1000;

    const raw = estimateRemainingSeconds({
      stage: progress.stage,
      percent: progress.percent,
      elapsedSeconds,
      elapsedInStageSeconds,
      done: progress.done,
      total: progress.total,
    });
    const smoothed = smoothEta(etaSmoothRef.current, raw);
    etaSmoothRef.current = smoothed;
    setEtaSeconds(smoothed);
  }, [loading, progress, nowMs]);

  function stopPolling() {
    if (pollTimerRef.current != null) {
      window.clearTimeout(pollTimerRef.current);
      pollTimerRef.current = null;
    }
  }

  async function revealMatchResults() {
    if (revealedRef.current) return;
    revealedRef.current = true;

    const scrollToResults = () => {
      document
        .getElementById("program-match-results")
        ?.scrollIntoView({ behavior: "smooth", block: "start" });
    };

    const programsUrl = () => {
      const url = new URL(window.location.href);
      url.searchParams.set("tab", "programs");
      return `${url.pathname}?${url.searchParams.toString()}`;
    };

    try {
      router.refresh();
      await new Promise((resolve) => window.setTimeout(resolve, 600));
      scrollToResults();
    } catch {
      window.location.assign(programsUrl());
      return;
    }

    await new Promise((resolve) => window.setTimeout(resolve, 700));
    const section = document.getElementById("program-match-results");
    const hasCards = Boolean(section?.querySelector("article"));
    if (!hasCards && (completeCountRef.current ?? 0) > 0) {
      window.location.assign(programsUrl());
      return;
    }
    scrollToResults();
  }

  function applyJob(job: ProgramMatchJobView) {
    jobIdRef.current = job.id;
    if (!startedAtRef.current) {
      startedAtRef.current = Date.parse(job.startedAt ?? job.createdAt) || Date.now();
      stageStartedAtRef.current = startedAtRef.current;
    }

    if (job.status === "PENDING" || job.status === "RUNNING") {
      setLoading(true);
      setError(null);
      setProgress(progressFromJob(job));
      const pendingFor =
        (Date.now() - Date.parse(job.createdAt)) / 1000;
      setWorkerHint(job.status === "PENDING" && pendingFor >= PENDING_STALE_SECONDS);
      return "active" as const;
    }

    if (job.status === "SUCCEEDED") {
      completeCountRef.current = job.matchCount ?? 0;
      setCompleteCount(job.matchCount ?? 0);
      setEtaSeconds(0);
      setWorkerHint(false);
      setProgress({
        stage: "done",
        label: job.label || `Готово: ${job.matchCount ?? 0} программ`,
        percent: 100,
        detail: job.detail ?? (job.engine ? `движок ${job.engine}` : undefined),
      });
      setLoading(false);
      void revealMatchResults();
      return "done" as const;
    }

    if (job.status === "FAILED") {
      setWorkerHint(false);
      setLoading(false);
      setError(job.error || "Подбор остановлен. Список программ не обновлён.");
      setProgress(
        job.label
          ? {
              stage: (job.stage as MatchProgressStage) || "profile",
              label: job.label,
              percent: job.percent,
              detail: job.detail ?? undefined,
            }
          : null,
      );
      return "failed" as const;
    }

    return "idle" as const;
  }

  async function pollOnce(): Promise<"active" | "done" | "failed" | "idle"> {
    const response = await fetch(
      `/api/admin/students/${studentId}/generate-matches`,
      { method: "GET", cache: "no-store" },
    );
    if (!response.ok) {
      throw new Error(
        response.status === 403
          ? "Нет доступа к этому студенту"
          : `Ошибка сервера (${response.status})`,
      );
    }
    const body = (await response.json()) as { job: ProgramMatchJobView | null };
    if (!body.job) return "idle";
    return applyJob(body.job);
  }

  function schedulePoll() {
    stopPolling();
    pollTimerRef.current = window.setTimeout(async () => {
      try {
        const state = await pollOnce();
        if (state === "active") schedulePoll();
      } catch (err) {
        setLoading(false);
        setError(
          err instanceof Error ? err.message : "Не удалось получить прогресс подбора",
        );
      }
    }, POLL_MS);
  }

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const state = await pollOnce();
        if (cancelled) return;
        if (state === "active") schedulePoll();
      } catch {
        // Resume is best-effort; curator can start again.
      }
    })();
    return () => {
      cancelled = true;
      stopPolling();
    };
    // Resume active job once when the student page mounts.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [studentId]);

  async function handleGenerate() {
    const start = Date.now();
    startedAtRef.current = start;
    stageStartedAtRef.current = start;
    lastStageRef.current = "profile";
    etaSmoothRef.current = null;
    completeCountRef.current = null;
    revealedRef.current = false;

    setLoading(true);
    setError(null);
    setCompleteCount(null);
    setEtaSeconds(null);
    setWorkerHint(false);
    setNowMs(start);
    setProgress({
      stage: "profile",
      label: "Запуск подбора программ…",
      percent: 2,
    });

    try {
      const response = await fetch(
        `/api/admin/students/${studentId}/generate-matches`,
        { method: "POST" },
      );
      if (!response.ok) {
        throw new Error(
          response.status === 403
            ? "Нет доступа к этому студенту"
            : `Ошибка сервера (${response.status})`,
        );
      }
      const body = (await response.json()) as {
        jobId: string;
        job: ProgramMatchJobView;
      };
      const state = applyJob(body.job);
      if (state === "active") schedulePoll();
    } catch (err) {
      setLoading(false);
      setError(
        err instanceof Error ? err.message : "Не удалось подобрать программы",
      );
    }
  }

  const activeIndex = stepIndex(progress?.stage ?? null);
  const showProgress = loading || completeCount != null || Boolean(error && progress);
  const elapsedSeconds =
    startedAtRef.current != null
      ? Math.max(0, (nowMs - startedAtRef.current) / 1000)
      : 0;

  const statusLabel =
    progress?.done != null && progress.total != null
      ? `${progress.done} / ${progress.total} программ`
      : null;

  return (
    <div className="w-full space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          onClick={handleGenerate}
          disabled={disabled || loading}
        >
          {loading ? "Подбор программ…" : "Подобрать программы"}
        </Button>
        {actions}
      </div>

      {showProgress ? (
        <div
          className="w-full space-y-4 rounded-2xl border bg-muted/30 p-4 sm:p-5"
          aria-live="polite"
          aria-busy={loading}
        >
          <div className="space-y-1.5">
            <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
              <span className="min-w-0 truncate">
                {progress?.label ?? "Подбор программ…"}
              </span>
              <span className="shrink-0 tabular-nums">
                {progress?.percent ?? 0}%
              </span>
            </div>
            <div className="relative h-2 w-full overflow-hidden rounded-full bg-muted">
              <div
                className={cn(
                  "h-full rounded-full bg-primary transition-[width] duration-500 ease-out",
                  loading && "animate-pulse",
                )}
                style={{ width: `${progress?.percent ?? 0}%` }}
              />
              {loading ? (
                <div
                  className="pointer-events-none absolute inset-y-0 w-1/3 bg-gradient-to-r from-transparent via-white/40 to-transparent match-progress-shimmer"
                  aria-hidden
                />
              ) : null}
            </div>
            <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-xs text-muted-foreground">
              <span className="tabular-nums">
                прошло {formatElapsed(elapsedSeconds)}
                {loading || etaSeconds != null ? (
                  <>
                    {" "}
                    · осталось {formatEtaLabel(loading ? etaSeconds : 0)}
                  </>
                ) : null}
              </span>
              {statusLabel ? (
                <span className="tabular-nums">{statusLabel}</span>
              ) : null}
            </div>
            {progress?.detail ? (
              <p className="text-xs text-muted-foreground">{progress.detail}</p>
            ) : null}
            {workerHint ? (
              <p className="text-xs text-[var(--danger-fg)]">
                Долго в очереди. Проверьте, что запущен worker (`npm run worker`).
              </p>
            ) : null}
            {completeCount != null && !loading ? (
              <p className="text-xs text-muted-foreground">
                {completeCount > 0 ? (
                  <>
                    Показаны {completeCount}{" "}
                    {completeCount === 1
                      ? "программа"
                      : completeCount < 5
                        ? "программы"
                        : "программ"}{" "}
                    ниже.{" "}
                    <a
                      href="#program-match-results"
                      className="font-medium text-[var(--brand)] underline-offset-2 hover:underline"
                    >
                      Перейти к результатам
                    </a>
                  </>
                ) : (
                  "Подбор завершён, подходящих программ не найдено."
                )}
              </p>
            ) : null}
          </div>

          <div className="w-full pb-1 md:overflow-x-auto">
            <ol className="flex w-full flex-col gap-2 md:min-w-[760px] md:flex-row md:items-start md:gap-0">
              {STEPS.map((step, index) => {
                const done = index < activeIndex;
                const active = index === activeIndex && loading;
                const connectorDone = index < activeIndex;

                return (
                  <li
                    key={step.id}
                    className="flex min-w-0 flex-1 items-center md:items-start"
                    aria-current={active ? "step" : undefined}
                  >
                    <div
                      className={cn(
                        "flex min-w-0 flex-1 flex-row items-center gap-2 text-left text-[13px] leading-4 md:flex-col md:items-center md:gap-0 md:text-center md:text-[11px]",
                        done && "text-primary",
                        active && "font-medium text-foreground",
                        !done && !active && "text-muted-foreground",
                      )}
                    >
                      <span
                        className={cn(
                          "inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full border bg-background text-xs transition-colors",
                          done &&
                            "border-primary bg-primary text-primary-foreground",
                          active &&
                            "border-primary bg-primary/10 text-primary animate-pulse",
                          !done && !active && "border-muted-foreground/30",
                        )}
                        aria-hidden
                      >
                        {done ? (
                          "✓"
                        ) : active ? (
                          <span className="block h-2.5 w-2.5 rounded-full border-2 border-primary border-t-transparent match-step-spin" />
                        ) : (
                          index + 1
                        )}
                      </span>
                      <span className="md:mt-2 md:max-w-[140px]">{step.label}</span>
                    </div>

                    {index < STEPS.length - 1 ? (
                      <span
                        className={cn(
                          "mt-3.5 hidden h-px min-w-4 flex-1 bg-border transition-colors md:block",
                          connectorDone && "bg-primary",
                        )}
                        aria-hidden
                      />
                    ) : null}
                  </li>
                );
              })}
            </ol>
          </div>
        </div>
      ) : null}

      {error ? <p className="text-sm text-destructive">{error}</p> : null}
    </div>
  );
}
