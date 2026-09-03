import { cn } from "@/lib/utils";
import { STATUS_LABELS } from "@/lib/labels";
import type {
  ApplicationStatus,
  DocumentStatus,
  RequirementStatus,
  StudentStatus,
  TaskStatus,
} from "@/lib/enums";

type StatusKind = "application" | "document" | "task" | "requirement" | "student";

type AnyStatus =
  | ApplicationStatus
  | DocumentStatus
  | TaskStatus
  | RequirementStatus
  | StudentStatus
  | string;

/** Calm 4-group palette: neutral / in-progress / attention / success|danger */
const toneMap: Record<string, string> = {
  // Neutral
  SELECTED: "bg-neutral-100 text-neutral-600",
  MISSING: "bg-neutral-100 text-neutral-600",
  TODO: "bg-neutral-100 text-neutral-600",
  NOT_APPLICABLE: "bg-neutral-50 text-neutral-400",
  NOT_SELECTED: "bg-neutral-100 text-neutral-500",
  ARCHIVED: "bg-neutral-100 text-neutral-500",
  PAUSED: "bg-neutral-100 text-neutral-600",
  // In progress (slate/info)
  PREPARING: "bg-[var(--info-bg)] text-[var(--info-fg)]",
  REQUESTED: "bg-[var(--info-bg)] text-[var(--info-fg)]",
  UPLOADED: "bg-[var(--info-bg)] text-[var(--info-fg)]",
  IN_PROGRESS: "bg-[var(--info-bg)] text-[var(--info-fg)]",
  SUBMITTED: "bg-[var(--info-bg)] text-[var(--info-fg)]",
  WAITING_RESULT: "bg-[var(--info-bg)] text-[var(--info-fg)]",
  ACTIVE: "bg-[var(--info-bg)] text-[var(--info-fg)]",
  // Attention (amber)
  UNDER_REVIEW: "bg-[var(--warning-bg)] text-[var(--warning-fg)]",
  WAITING: "bg-[var(--warning-bg)] text-[var(--warning-fg)]",
  READY_FOR_REVIEW: "bg-[var(--warning-bg)] text-[var(--warning-fg)]",
  READY_TO_SUBMIT: "bg-[var(--warning-bg)] text-[var(--warning-fg)]",
  NEEDS_CHANGES: "bg-[var(--warning-bg)] text-[var(--warning-fg)]",
  ADDITIONAL_DOCUMENTS: "bg-[var(--warning-bg)] text-[var(--warning-fg)]",
  WAITLISTED: "bg-[var(--warning-bg)] text-[var(--warning-fg)]",
  BLOCKED: "bg-[var(--warning-bg)] text-[var(--warning-fg)]",
  // Success
  APPROVED: "bg-[var(--ok-bg)] text-[var(--ok-fg)]",
  COMPLETED: "bg-[var(--ok-bg)] text-[var(--ok-fg)]",
  ADMITTED: "bg-[var(--ok-bg)] text-[var(--ok-fg)]",
  ENROLLED: "bg-[var(--ok-bg)] text-[var(--ok-fg)]",
  DONE: "bg-[var(--ok-bg)] text-[var(--ok-fg)]",
  // Danger
  REJECTED: "bg-[var(--danger-bg)] text-[var(--danger-fg)]",
  EXPIRED: "bg-[var(--danger-bg)] text-[var(--danger-fg)]",
};

function formatStatus(status: string) {
  return STATUS_LABELS[status] ?? status.replaceAll("_", " ");
}

export interface StatusBadgeProps {
  status: AnyStatus;
  kind?: StatusKind;
  className?: string;
}

export function StatusBadge({ status, className }: StatusBadgeProps) {
  const key = String(status);
  return (
    <span
      className={cn(
        "surface-chip inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium leading-none",
        toneMap[key] ?? "bg-neutral-100 text-neutral-600",
        className
      )}
    >
      {formatStatus(key)}
    </span>
  );
}
