import { prisma } from "@/lib/db";
import { getCurrentStudent } from "@/server/auth/guards";
import { portalCompleteTaskAction } from "@/server/actions";
import { StatusBadge } from "@/components/status-badge";
import { EmptyState } from "@/components/empty-state";
import { Button } from "@/components/ui/button";
import { formatDate } from "@/lib/utils";

export default async function PortalTasksPage() {
  const { student } = await getCurrentStudent();

  const tasks = await prisma.task.findMany({
    where: {
      studentId: student.id,
      isStudentFacing: true,
    },
    orderBy: [{ status: "asc" }, { dueDate: "asc" }],
  });

  const open = tasks.filter((t) => t.status !== "DONE");
  const done = tasks.filter((t) => t.status === "DONE");

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-[28px] font-semibold tracking-tight">Задачи</h1>
        <p className="mt-1 text-[15px] text-muted-foreground">
          Действия, которые назначил вам куратор
        </p>
      </div>

      {tasks.length === 0 ? (
        <EmptyState
          title="Сейчас делать нечего"
          description="Задачи для вас появятся здесь."
        />
      ) : (
        <div className="space-y-6">
          {open.length > 0 ? (
            <section className="space-y-3">
              <h2 className="text-[20px] font-semibold tracking-tight text-foreground">
                Открытые
              </h2>
              <ul className="space-y-3">
                {open.map((task) => (
                  <li
                    key={task.id}
                    className="surface-card p-4"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="font-medium text-foreground">{task.title}</p>
                        {task.description ? (
                          <p className="mt-1 text-sm text-muted-foreground">
                            {task.description}
                          </p>
                        ) : null}
                        {task.dueDate ? (
                          <p className="mt-1 text-[13px] text-muted-foreground">
                            Срок: {formatDate(task.dueDate)}
                          </p>
                        ) : null}
                      </div>
                      <StatusBadge status={task.status} kind="task" />
                    </div>
                    <form
                      action={portalCompleteTaskAction.bind(null, task.id)}
                      className="mt-3"
                    >
                      <Button type="submit" size="sm">
                        Отметить выполненной
                      </Button>
                    </form>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          {done.length > 0 ? (
            <section className="space-y-3">
              <h2 className="text-[20px] font-semibold tracking-tight text-foreground">
                Выполненные
              </h2>
              <ul className="space-y-2">
                {done.map((task) => (
                  <li
                    key={task.id}
                    className="surface-card flex items-center justify-between px-4 py-3"
                  >
                    <span className="text-sm text-muted-foreground line-through">
                      {task.title}
                    </span>
                    <StatusBadge status={task.status} kind="task" />
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </div>
      )}
    </div>
  );
}
