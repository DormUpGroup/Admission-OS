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
      <h2 className="text-[20px] font-semibold tracking-tight text-foreground">
        Сейчас важно
      </h2>
      {tasks.length === 0 ? (
        <p className="surface-card px-5 py-5 text-[15px] leading-relaxed text-muted-foreground">
          {emptyMessage}
        </p>
      ) : (
        <ul className="space-y-3">
          {tasks.map((task) => (
            <li
              key={task.id}
              className="surface-card px-5 py-4"
            >
              <p className="text-[17px] font-medium tracking-tight text-foreground">
                {task.title}
              </p>
              <p className="mt-1 text-[15px] text-muted-foreground">{task.reason}</p>
              {task.dueDate ? (
                <p
                  className={
                    task.dueDateOverdue
                      ? "mt-2 text-[13px] font-medium text-[var(--danger-fg)]"
                      : "mt-2 text-[13px] text-muted-foreground"
                  }
                >
                  Срок: {formatDate(task.dueDate)}
                  {task.dueDateOverdue ? " · просрочен" : ""}
                </p>
              ) : null}
              <div className="mt-3">
                <Button asChild size="lg" variant="outline">
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
