import { cn } from "@/lib/utils";
import { STATUS_LABELS } from "@/lib/labels";
import type { DocumentStatus } from "@/lib/enums";

const config: Record<string, { className: string; dot: string }> = {
  MISSING: {
    className: "bg-neutral-100 text-neutral-600",
    dot: "bg-neutral-400",
  },
  REQUESTED: {
    className: "bg-[var(--info-bg)] text-[var(--info-fg)]",
    dot: "bg-[var(--info)]",
  },
  UPLOADED: {
    className: "bg-[var(--info-bg)] text-[var(--info-fg)]",
    dot: "bg-[var(--info)]",
  },
  UNDER_REVIEW: {
    className: "bg-[var(--warning-bg)] text-[var(--warning-fg)]",
    dot: "bg-[var(--warning)]",
  },
  APPROVED: {
    className: "bg-[var(--ok-bg)] text-[var(--ok-fg)]",
    dot: "bg-[var(--ok)]",
  },
  NEEDS_CHANGES: {
    className: "bg-[var(--warning-bg)] text-[var(--warning-fg)]",
    dot: "bg-[var(--warning)]",
  },
  EXPIRED: {
    className: "bg-[var(--danger-bg)] text-[var(--danger-fg)]",
    dot: "bg-[var(--danger)]",
  },
};

export interface DocumentStatusBadgeProps {
  status: DocumentStatus | string;
  className?: string;
}

export function DocumentStatusBadge({
  status,
  className,
}: DocumentStatusBadgeProps) {
  const key = String(status);
  const c = config[key] ?? {
    className: "bg-neutral-100 text-neutral-600",
    dot: "bg-neutral-400",
  };

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-medium leading-none",
        c.className,
        className
      )}
    >
      <span className={cn("h-1.5 w-1.5 rounded-full", c.dot)} />
      {STATUS_LABELS[key] ?? key}
    </span>
  );
}
