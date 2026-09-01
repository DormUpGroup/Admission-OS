import { cn } from "@/lib/utils";
import type { JourneyStageView } from "@/server/services/student-journey";

const STATUS_CLASS: Record<string, string> = {
  CURRENT: "border-[var(--brand)] bg-white text-[var(--foreground)] shadow-sm",
  WAITING_CURATOR:
    "border-[var(--brand)] bg-white text-[var(--foreground)] shadow-sm",
  DONE: "border-[var(--ok)]/30 bg-[var(--ok-bg)] text-[var(--ok-fg)]",
  NEXT: "border-[var(--border)] bg-white text-muted-foreground",
  UNAVAILABLE: "border-transparent bg-transparent text-muted-foreground/80",
};

const DOT_CLASS: Record<string, string> = {
  CURRENT: "bg-[var(--brand)]",
  WAITING_CURATOR: "bg-[var(--warning)]",
  DONE: "bg-[var(--ok)]",
  NEXT: "bg-[var(--border)]",
  UNAVAILABLE: "bg-[var(--border)]",
};

export function JourneyRoute({ stages }: { stages: JourneyStageView[] }) {
  return (
    <ol className="grid grid-cols-2 gap-3 sm:grid-cols-4 sm:gap-4">
      {stages.map((stage, index) => {
        const active =
          stage.status === "CURRENT" || stage.status === "WAITING_CURATOR";
        return (
          <li key={stage.id} className="min-w-0">
            <div
              className={cn(
                "h-full rounded-2xl border px-3 py-3",
                STATUS_CLASS[stage.status],
                active ? "ring-1 ring-[var(--brand)]/15" : ""
              )}
            >
              <p className="text-[11px] tabular-nums text-muted-foreground">
                {index + 1} из 4
              </p>
              <p
                className={cn(
                  "mt-1 text-sm",
                  active ? "font-semibold text-[var(--foreground)]" : "font-medium"
                )}
              >
                {stage.label}
              </p>
              <p className="mt-2 flex items-center gap-1.5 text-xs">
                <span
                  className={cn(
                    "h-1.5 w-1.5 shrink-0 rounded-full",
                    DOT_CLASS[stage.status]
                  )}
                />
                {stage.statusLabel}
              </p>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
