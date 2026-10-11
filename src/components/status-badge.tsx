import { cn } from "@/lib/utils";
import { STATUS_LABELS } from "@/lib/labels";
import { statusToneClasses, toneForStatus } from "@/lib/status-tones";
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
  const tone = toneForStatus(key);
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-[var(--radius-badge)] px-2 py-0.5 text-[12px] font-medium leading-none",
        statusToneClasses[tone],
        className
      )}
    >
      {formatStatus(key)}
    </span>
  );
}
