import Link from "next/link";
import { Button } from "@/components/ui/button";
import { formatDate } from "@/lib/utils";
import type { JourneyNowTask } from "@/server/services/student-journey";

export function JourneyNow({
  tasks,
  emptyMessage,
}: {
  tasks: JourneyNowTask[];
  emptyMessage: string | null;
}) {
  return (
    <section className="space-y-3">
      <h2 className="text-sm font-semibold text-[var(--foreground)]">
        Сейчас важно
      </h2>
      {tasks.length === 0 ? (
        <p className="rounded-2xl border border-[var(--border)] bg-white px-4 py-5 text-sm leading-relaxed text-muted-foreground">
          {emptyMessage}
        </p>
      ) : (
        <ul className="space-y-3">
          {tasks.map((task) => (
            <li
              key={task.id}
              className="rounded-2xl border border-[var(--border)] bg-white px-4 py-4"
            >
              <p className="text-[15px] font-medium text-[var(--foreground)]">
                {task.title}
              </p>
              <p className="mt-1 text-sm text-muted-foreground">{task.reason}</p>
              {task.dueDate ? (
                <p
                  className={
                    task.dueDateOverdue
                      ? "mt-2 text-xs font-medium text-[var(--danger-fg)]"
                      : "mt-2 text-xs text-muted-foreground"
                  }
                >
                  Срок: {formatDate(task.dueDate)}
                  {task.dueDateOverdue ? " · просрочен" : ""}
                </p>
              ) : null}
              <div className="mt-3">
                <Button asChild size="lg" variant="outline" className="h-11 sm:h-9">
                  <Link href={task.actionHref}>{task.actionLabel}</Link>
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
