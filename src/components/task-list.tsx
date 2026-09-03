import Link from "next/link";
import { cn, formatDate } from "@/lib/utils";
import { StatusBadge } from "@/components/status-badge";
import type { TaskPriority, TaskStatus } from "@/lib/enums";

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

const priorityTone: Record<string, string> = {
  LOW: "text-neutral-400",
  MEDIUM: "text-amber-600",
  HIGH: "text-orange-600",
  URGENT: "text-red-600",
};

export function TaskList({
  tasks,
  className,
  emptyMessage = "Нет задач",
}: TaskListProps) {
  if (tasks.length === 0) {
    return (
      <p className={cn("text-xs text-muted-foreground py-4", className)}>
        {emptyMessage}
      </p>
    );
  }

  return (
    <ul className={cn("divide-y divide-border surface-card", className)}>
      {tasks.map((task) => {
        const row = (
          <div className="flex items-center gap-3 px-3 py-2.5 hover:bg-muted/60 transition-colors">
            <div className="min-w-0 flex-1">
              <p className="truncate text-[13px] font-medium text-foreground">
                {task.title}
              </p>
              <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-muted-foreground">
                {task.studentName ? <span>{task.studentName}</span> : null}
                {task.dueDate ? (
                  <span className="tabular-nums">До {formatDate(task.dueDate)}</span>
                ) : null}
                {task.priority ? (
                  <span className={cn("font-medium", priorityTone[task.priority] ?? "")}>
                    {String(task.priority).toLowerCase()}
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
