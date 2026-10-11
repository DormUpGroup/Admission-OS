import Link from "next/link";
import { cn, formatDate } from "@/lib/utils";
import { StatusBadge } from "@/components/status-badge";
import { statusToneClasses, toneForStatus } from "@/lib/status-tones";
import type { TaskPriority, TaskStatus } from "@/lib/enums";
import { STATUS_LABELS } from "@/lib/labels";

export interface TaskListItem {
  id: string;
  title: string;
  status: TaskStatus | string;
  priority?: TaskPriority | string | null;
  dueDate?: Date | string | null;
  studentName?: string | null;
  href?: string;
}

export interface TaskListProps {
  tasks: TaskListItem[];
  className?: string;
  emptyMessage?: string;
}

export function TaskList({
  tasks,
  className,
  emptyMessage = "Нет задач",
}: TaskListProps) {
  if (tasks.length === 0) {
    return (
      <p className={cn("py-4 text-[13px] text-muted-foreground", className)}>
        {emptyMessage}
      </p>
    );
  }

  return (
    <ul
      className={cn(
        "divide-y divide-[var(--divider)] overflow-hidden rounded-[var(--radius-card)] border border-border bg-card",
        className
      )}
    >
      {tasks.map((task) => {
        const priority = task.priority ? String(task.priority) : null;
        const priorityTone = priority ? toneForStatus(priority) : null;
        const row = (
          <div className="flex items-center gap-3 px-3 py-2.5 transition-colors hover:bg-[var(--brand-soft)]/40">
            <div className="min-w-0 flex-1">
              <p className="truncate text-[13px] font-semibold text-foreground">
                {task.title}
              </p>
              <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-muted-foreground">
                {task.studentName ? <span>{task.studentName}</span> : null}
                {task.dueDate ? (
                  <span className="tabular-nums">До {formatDate(task.dueDate)}</span>
                ) : null}
                {priority && priorityTone ? (
                  <span
                    className={cn(
                      "rounded-[var(--radius-badge)] px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
                      statusToneClasses[priorityTone]
                    )}
                  >
                    {STATUS_LABELS[priority] ?? priority.toLowerCase()}
                  </span>
                ) : null}
              </div>
            </div>
            <StatusBadge status={task.status} kind="task" />
          </div>
        );

        return (
          <li key={task.id}>
            {task.href ? <Link href={task.href}>{row}</Link> : row}
          </li>
        );
      })}
    </ul>
  );
}
