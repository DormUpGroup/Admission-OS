"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type {
  MatchProgressEvent,
  MatchProgressStage,
} from "@/server/services/program-matching/program-matching";

const STEPS: { id: MatchProgressStage; label: string }[] = [
  { id: "profile", label: "Профиль анкеты" },
  { id: "universitaly", label: "Поиск на Universitaly" },
  { id: "score", label: "Оценка программ" },
  { id: "enrich", label: "Досье программ" },
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

  async function handleGenerate() {
    setLoading(true);
    setError(null);
    setCompleteCount(null);
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

  return (
    <div className="w-full max-w-lg space-y-3">
      <Button
        type="button"
        onClick={handleGenerate}
        disabled={disabled || loading}
      >
        {loading ? "Подбор программ…" : "Generate Program Matches"}
      </Button>

      {showProgress ? (
        <div
          className="rounded-lg border bg-muted/30 p-4 space-y-3"
          aria-live="polite"
          aria-busy={loading}
        >
          <div className="space-y-1.5">
            <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
              <span>{progress?.label ?? "Подбор программ…"}</span>
              <span>{progress?.percent ?? 0}%</span>
            </div>
            <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
              <div
                className={cn(
                  "h-full rounded-full bg-primary transition-[width] duration-500 ease-out",
                  loading && progress?.stage === "universitaly" && "animate-pulse"
                )}
                style={{ width: `${progress?.percent ?? 0}%` }}
              />
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
                      done && "border-primary bg-primary text-primary-foreground",
                      active && "border-primary",
                      !done && !active && "border-muted-foreground/30"
                    )}
                    aria-hidden
                  >
                    {done ? "✓" : active ? "…" : index + 1}
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
