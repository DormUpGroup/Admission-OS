import { cn } from "@/lib/utils";

export interface ProgressBarProps {
  value: number;
  max?: number;
  className?: string;
  barClassName?: string;
  showLabel?: boolean;
  size?: "sm" | "md";
}

export function ProgressBar({
  value,
  max = 100,
  className,
  barClassName,
  showLabel = false,
  size = "sm",
}: ProgressBarProps) {
  const pct = Math.min(100, Math.max(0, max === 0 ? 0 : (value / max) * 100));

  return (
    <div className={cn("w-full", className)}>
      {showLabel ? (
        <div className="mb-1 flex items-center justify-between text-[11px] text-muted-foreground">
          <span>Прогресс</span>
          <span className="tabular-nums">{Math.round(pct)}%</span>
        </div>
      ) : null}
      <div
        className={cn(
          "w-full overflow-hidden rounded-full bg-muted",
          size === "sm" ? "h-1.5" : "h-2"
        )}
      >
        <div
          className={cn(
            "h-full rounded-full bg-[var(--brand)] transition-[width] duration-300",
            barClassName
          )}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}
