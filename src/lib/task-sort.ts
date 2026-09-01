import { daysUntil } from "@/lib/utils";

const PRIORITY_RANK: Record<string, number> = {
  URGENT: 0,
  HIGH: 1,
  MEDIUM: 2,
  LOW: 3,
};

export type SortableTask = {
  status: string;
  priority: string;
  dueDate: Date | null;
  createdAt: Date;
};

function startOfToday() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

function endOfToday() {
  const d = new Date();
  d.setHours(23, 59, 59, 999);
  return d;
}

export function isTaskOverdue(task: Pick<SortableTask, "status" | "dueDate">) {
  if (task.status === "DONE" || !task.dueDate) return false;
  return task.dueDate < startOfToday();
}

export function isTaskDueToday(task: Pick<SortableTask, "status" | "dueDate">) {
  if (task.status === "DONE" || !task.dueDate) return false;
  return task.dueDate >= startOfToday() && task.dueDate <= endOfToday();
}

export type TaskUrgency = "overdue" | "today" | "upcoming" | "none";

export function taskUrgency(task: Pick<SortableTask, "status" | "dueDate">): TaskUrgency {
  if (task.status === "DONE") return "none";
  if (isTaskOverdue(task)) return "overdue";
  if (isTaskDueToday(task)) return "today";
  if (task.dueDate) return "upcoming";
  return "none";
}

export function compareTasksByUrgency(a: SortableTask, b: SortableTask) {
  const aDone = a.status === "DONE" ? 1 : 0;
  const bDone = b.status === "DONE" ? 1 : 0;
  if (aDone !== bDone) return aDone - bDone;

  const aOver = isTaskOverdue(a) ? 0 : 1;
  const bOver = isTaskOverdue(b) ? 0 : 1;
  if (aOver !== bOver) return aOver - bOver;

  const aPri = PRIORITY_RANK[a.priority] ?? 9;
  const bPri = PRIORITY_RANK[b.priority] ?? 9;
  if (aPri !== bPri) return aPri - bPri;

  if (!a.dueDate && !b.dueDate) {
    return b.createdAt.getTime() - a.createdAt.getTime();
  }
  if (!a.dueDate) return 1;
  if (!b.dueDate) return -1;
  const dueDiff = a.dueDate.getTime() - b.dueDate.getTime();
  if (dueDiff !== 0) return dueDiff;

  return b.createdAt.getTime() - a.createdAt.getTime();
}

export function sortTasksByUrgency<T extends SortableTask>(tasks: T[]): T[] {
  return [...tasks].sort(compareTasksByUrgency);
}

export function groupTasksByUrgency<T extends SortableTask>(tasks: T[]) {
  const sorted = sortTasksByUrgency(tasks);
  return {
    overdue: sorted.filter((t) => isTaskOverdue(t)),
    today: sorted.filter((t) => isTaskDueToday(t)),
    upcoming: sorted.filter(
      (t) => t.status !== "DONE" && !isTaskOverdue(t) && !isTaskDueToday(t)
    ),
    done: sorted.filter((t) => t.status === "DONE"),
  };
}

export function dueDateLabel(dueDate: Date | null | undefined) {
  if (!dueDate) return { text: "—", className: "text-muted-foreground" };
  const days = daysUntil(dueDate);
  if (days < 0) {
    return {
      text: `просрочено ${Math.abs(days)} дн.`,
      className: "text-[var(--danger-fg)] font-medium",
    };
  }
  if (days === 0) {
    return {
      text: "Сегодня",
      className: "text-[var(--warning-fg)] font-medium",
    };
  }
  return {
    text: dueDate.toLocaleDateString("ru-RU", {
      day: "numeric",
      month: "short",
      year: "numeric",
    }),
    className: "text-muted-foreground",
  };
}
