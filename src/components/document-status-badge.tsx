import { cn } from "@/lib/utils";
import { STATUS_LABELS } from "@/lib/labels";
import {
  statusDotClasses,
  statusToneClasses,
  toneForStatus,
} from "@/lib/status-tones";
import type { DocumentStatus } from "@/lib/enums";

export interface DocumentStatusBadgeProps {
  status: DocumentStatus | string;
  className?: string;
}

export function DocumentStatusBadge({
  status,
  className,
}: DocumentStatusBadgeProps) {
  const key = String(status);
  const tone = toneForStatus(key);

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-[var(--radius-badge)] px-2 py-0.5 text-[12px] font-medium leading-none",
        statusToneClasses[tone],
        className
      )}
    >
      <span
        className={cn("h-1.5 w-1.5 shrink-0 rounded-full", statusDotClasses[tone])}
        aria-hidden
      />
      {STATUS_LABELS[key] ?? key}
    </span>
  );
}
