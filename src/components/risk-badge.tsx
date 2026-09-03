import { cn } from "@/lib/utils";
import { RISK_LABELS } from "@/lib/labels";
import type { RiskLevel } from "@/lib/enums";

const riskConfig: Record<RiskLevel, { className: string; dot: string }> = {
  NONE: {
    className: "bg-neutral-100 text-neutral-500",
    dot: "bg-neutral-400",
  },
  LOW: {
    className: "bg-neutral-100 text-neutral-600",
    dot: "bg-neutral-400",
  },
  MEDIUM: {
    className: "bg-[var(--warning-bg)] text-[var(--warning-fg)]",
    dot: "bg-[var(--warning)]",
  },
  HIGH: {
    className: "bg-orange-50 text-orange-800",
    dot: "bg-orange-500",
  },
  CRITICAL: {
    className: "bg-[var(--danger-bg)] text-[var(--danger-fg)]",
    dot: "bg-[var(--danger)]",
  },
};

export interface RiskBadgeProps {
  level: RiskLevel | string;
  className?: string;
  showDot?: boolean;
}

export function RiskBadge({
  level,
  className,
  showDot = true,
}: RiskBadgeProps) {
  const key = (level in riskConfig ? level : "NONE") as RiskLevel;
  const config = riskConfig[key];

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full surface-chip px-2 py-0.5 text-[11px] font-medium leading-none",
        config.className,
        className
      )}
    >
      {showDot && (
        <span className={cn("h-1.5 w-1.5 rounded-full", config.dot)} />
      )}
      {RISK_LABELS[key]}
    </span>
  );
}
