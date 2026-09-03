import { cn } from "@/lib/utils";
import type { JourneyStageView } from "@/server/services/student-journey";

const STATUS_CLASS: Record<string, string> = {
  CURRENT: "surface-card text-foreground",
  WAITING_CURATOR: "surface-card text-foreground",
  DONE: "border-transparent bg-[var(--ok-bg)] text-[var(--ok-fg)]",
  NEXT: "surface-card text-muted-foreground",
  UNAVAILABLE: "border-transparent bg-transparent text-muted-foreground/80 shadow-none",
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
                "h-full rounded-[22px] px-4 py-4",
                STATUS_CLASS[stage.status],
                active ? "ring-1 ring-[var(--brand)]/25" : ""
              )}
            >
              <p className="text-[11px] tabular-nums text-muted-foreground">
                {index + 1} из 4
              </p>
              <p
                className={cn(
                  "mt-1 text-[15px]",
                  active ? "font-semibold text-foreground" : "font-medium"
                )}
              >
                {stage.label}
              </p>
              <p className="mt-2 flex items-center gap-1.5 text-[13px]">
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
