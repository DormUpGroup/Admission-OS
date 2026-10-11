import { cn } from "@/lib/utils";
import { RISK_LABELS } from "@/lib/labels";
import {
  statusDotClasses,
  statusToneClasses,
  type StatusTone,
} from "@/lib/status-tones";
import type { RiskLevel } from "@/lib/enums";

const riskTone: Record<RiskLevel, StatusTone> = {
  NONE: "neutral",
  LOW: "neutral",
  MEDIUM: "warning",
  HIGH: "warning",
  CRITICAL: "danger",
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
  const key = (level in riskTone ? level : "NONE") as RiskLevel;
  const tone = riskTone[key];

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-[var(--radius-badge)] px-2 py-0.5 text-[12px] font-medium leading-none",
        statusToneClasses[tone],
        className
      )}
    >
      {showDot ? (
        <span
          className={cn("h-1.5 w-1.5 shrink-0 rounded-full", statusDotClasses[tone])}
          aria-hidden
        />
      ) : null}
      {RISK_LABELS[key]}
    </span>
  );
}
