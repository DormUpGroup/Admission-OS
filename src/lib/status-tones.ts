/** Shared semantic tone classes for status / priority badges. */

export type StatusTone = "neutral" | "info" | "warning" | "ok" | "danger" | "purple";

export const statusToneClasses: Record<StatusTone, string> = {
  neutral: "bg-muted text-[var(--text-secondary)]",
  info: "bg-[var(--info-bg)] text-[var(--info-fg)]",
  warning: "bg-[var(--warning-bg)] text-[var(--warning-fg)]",
  ok: "bg-[var(--ok-bg)] text-[var(--ok-fg)]",
  danger: "bg-[var(--danger-bg)] text-[var(--danger-fg)]",
  purple: "bg-[var(--purple-bg)] text-[var(--purple-fg)]",
};

export const statusDotClasses: Record<StatusTone, string> = {
  neutral: "bg-[var(--muted-foreground)]",
  info: "bg-[var(--info)]",
  warning: "bg-[var(--warning)]",
  ok: "bg-[var(--ok)]",
  danger: "bg-[var(--danger)]",
  purple: "bg-[var(--purple)]",
};

/** Calm 4-group palette mapped to domain status keys */
export const statusToneByKey: Record<string, StatusTone> = {
  // Neutral
  SELECTED: "neutral",
  MISSING: "neutral",
  TODO: "neutral",
  NOT_APPLICABLE: "neutral",
  NOT_SELECTED: "neutral",
  ARCHIVED: "neutral",
  PAUSED: "neutral",
  NONE: "neutral",
  PENDING: "neutral",
  LOW: "neutral",
  // In progress
  PREPARING: "info",
  REQUESTED: "info",
  UPLOADED: "info",
  IN_PROGRESS: "info",
  SUBMITTED: "info",
  WAITING_RESULT: "info",
  ACTIVE: "info",
  // Attention
  UNDER_REVIEW: "warning",
  WAITING: "warning",
  READY_FOR_REVIEW: "warning",
  READY_TO_SUBMIT: "warning",
  NEEDS_CHANGES: "warning",
  ADDITIONAL_DOCUMENTS: "warning",
  WAITLISTED: "warning",
  BLOCKED: "warning",
  MEDIUM: "warning",
  HIGH: "warning",
  // Success
  APPROVED: "ok",
  COMPLETED: "ok",
  ADMITTED: "ok",
  ENROLLED: "ok",
  DONE: "ok",
  ACCEPTED: "ok",
  // Danger
  REJECTED: "danger",
  EXPIRED: "danger",
  CRITICAL: "danger",
  URGENT: "danger",
};

export function toneForStatus(status: string): StatusTone {
  return statusToneByKey[status] ?? "neutral";
}
