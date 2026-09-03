"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type {
  MatchProgressEvent,
  MatchProgressStage,
} from "@/server/services/program-matching/program-matching";
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

type StreamEvent =
  | MatchProgressEvent
  | { stage: "complete"; count: number; engine?: string }
  | { stage: "error"; message: string };

function stepIndex(stage: MatchProgressStage | "complete" | "error" | null) {
  if (!stage || stage === "complete" || stage === "error" || stage === "done") {
    return STEPS.length;
  }
  if (stage === "enrich") {
    return STEPS.findIndex((s) => s.id === "ai_extract");
  }
  return STEPS.findIndex((s) => s.id === stage);
}

export function GenerateProgramMatchesButton({
  studentId,
  disabled,
}: {
  studentId: string;
  disabled?: boolean;
}) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState<MatchProgressEvent | null>(null);
  const [completeCount, setCompleteCount] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [etaSeconds, setEtaSeconds] = useState<number | null>(null);

  const startedAtRef = useRef<number | null>(null);
  const stageStartedAtRef = useRef<number | null>(null);
  const lastStageRef = useRef<MatchProgressStage | null>(null);
  const etaSmoothRef = useRef<number | null>(null);

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

  async function handleGenerate() {
    const start = Date.now();
    startedAtRef.current = start;
    stageStartedAtRef.current = start;
    lastStageRef.current = "profile";
    etaSmoothRef.current = null;

    setLoading(true);
    setError(null);
    setCompleteCount(null);
    setEtaSeconds(null);
    setNowMs(start);
    setProgress({
      stage: "profile",
      label: "Запуск подбора программ…",
      percent: 2,
    });

    try {
      const response = await fetch(
        `/api/admin/students/${studentId}/generate-matches`,
        { method: "POST" }
      );

      if (!response.ok) {
        throw new Error(
          response.status === 403
            ? "Нет доступа к этому студенту"
            : `Ошибка сервера (${response.status})`
        );
      }

      if (!response.body) {
        throw new Error("Сервер не вернул поток прогресса");
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          if (!line.trim()) continue;
          const event = JSON.parse(line) as StreamEvent;

          if (event.stage === "error") {
            throw new Error(event.message);
          }

          if (event.stage === "complete") {
            setCompleteCount(event.count);
            setEtaSeconds(0);
            setProgress({
              stage: "done",
              label: `Готово: ${event.count} программ`,
              percent: 100,
              detail: event.engine ? `движок ${event.engine}` : undefined,
            });
            router.refresh();
            continue;
          }

          setProgress(event);
        }
      }
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Не удалось подобрать программы"
      );
    } finally {
      setLoading(false);
    }
  }

  const activeIndex = stepIndex(progress?.stage ?? null);
  const showProgress = loading || completeCount != null;
  const elapsedSeconds =
    startedAtRef.current != null
      ? Math.max(0, (nowMs - startedAtRef.current) / 1000)
      : 0;

  const statusLabel =
    progress?.done != null && progress.total != null
      ? `${progress.done} / ${progress.total} программ`
      : null;

  return (
    <div className="max-w-lg space-y-3">
      <Button
        type="button"
        onClick={handleGenerate}
        disabled={disabled || loading}
      >
        {loading ? "Подбор программ…" : "Подобрать программы"}
      </Button>

      {showProgress ? (
        <div
          className="rounded-2xl border bg-muted/30 p-4 space-y-3"
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
                  loading && "animate-pulse"
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
          </div>

          <ol className="grid gap-1 sm:grid-cols-2">
            {STEPS.map((step, index) => {
              const done = index < activeIndex;
              const active = index === activeIndex && loading;
              return (
                <li
                  key={step.id}
                  className={cn(
                    "flex items-center gap-2 text-xs",
                    done && "text-primary",
                    active && "font-medium text-foreground",
                    !done && !active && "text-muted-foreground"
                  )}
                >
                  <span
                    className={cn(
                      "inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full border text-[10px]",
                      done &&
                        "border-primary bg-primary text-primary-foreground",
                      active && "border-primary animate-pulse",
                      !done && !active && "border-muted-foreground/30"
                    )}
                    aria-hidden
                  >
                    {done ? (
                      "✓"
                    ) : active ? (
                      <span className="block h-2.5 w-2.5 rounded-full border border-primary border-t-transparent match-step-spin" />
                    ) : (
                      index + 1
                    )}
                  </span>
                  {step.label}
                </li>
              );
            })}
          </ol>
        </div>
      ) : null}

      {error ? <p className="text-sm text-destructive">{error}</p> : null}
    </div>
  );
}
