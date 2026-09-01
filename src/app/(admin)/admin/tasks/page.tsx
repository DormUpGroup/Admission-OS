import Link from "next/link";
import { prisma } from "@/lib/db";
import { requireStaff, studentScopeWhere } from "@/server/auth/guards";
import { completeTaskAction } from "@/server/actions";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/empty-state";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import {
  DataTable,
  DataTableBody,
  DataTableCell,
  DataTableHead,
  DataTableHeader,
  DataTableRow,
} from "@/components/data-table";
import { cn, fullName } from "@/lib/utils";
import { labelOf } from "@/lib/labels";
import {
  dueDateLabel,
  groupTasksByUrgency,
  sortTasksByUrgency,
  taskUrgency,
} from "@/lib/task-sort";
import type { Prisma } from "@prisma/client";
import { endOfDay, startOfDay } from "date-fns";

const VIEWS = [
  { key: "my", label: "Мои задачи" },
  { key: "today", label: "Сегодня" },
  { key: "overdue", label: "Просрочено" },
  { key: "upcoming", label: "Предстоящие" },
  { key: "waiting", label: "Ожидание" },
  { key: "completed", label: "Завершённые" },
] as const;

type ViewKey = (typeof VIEWS)[number]["key"];

function taskWhere(
  view: ViewKey,
  userId: string,
  studentScope: Prisma.StudentWhereInput
): Prisma.TaskWhereInput {
  const base: Prisma.TaskWhereInput = { student: studentScope };
  const now = new Date();
  const todayStart = startOfDay(now);
  const todayEnd = endOfDay(now);

  switch (view) {
    case "my":
      return {
        ...base,
        assigneeId: userId,
        status: { not: "DONE" },
      };
    case "today":
      return {
        ...base,
        status: { not: "DONE" },
        dueDate: { gte: todayStart, lte: todayEnd },
      };
    case "overdue":
      return {
        ...base,
        status: { not: "DONE" },
        dueDate: { lt: todayStart },
      };
    case "upcoming":
      return {
        ...base,
        status: { not: "DONE" },
        dueDate: { gt: todayEnd },
      };
    case "waiting":
      return {
        ...base,
        status: "WAITING",
      };
    case "completed":
      return {
        ...base,
        status: "DONE",
      };
    default:
      return base;
  }
}

function urgencyRowClass(urgency: ReturnType<typeof taskUrgency>) {
  if (urgency === "overdue") {
    return "border-l-[3px] border-l-[var(--danger)] bg-[var(--danger-bg)]/40";
  }
  if (urgency === "today") {
    return "border-l-[3px] border-l-[var(--warning)] bg-[var(--warning-bg)]/50";
  }
  return "border-l-[3px] border-l-transparent";
}

function PriorityCell({ priority }: { priority: string }) {
  if (priority === "URGENT" || priority === "HIGH") {
    return (
      <span
        className={cn(
          "inline-flex rounded px-1.5 py-0.5 text-[11px] font-medium",
          priority === "URGENT"
            ? "bg-[var(--danger-bg)] text-[var(--danger-fg)]"
            : "bg-[var(--warning-bg)] text-[var(--warning-fg)]"
        )}
      >
        {labelOf(priority)}
      </span>
    );
  }
  return (
    <span className="text-xs text-muted-foreground">{labelOf(priority)}</span>
  );
}

function TaskRows({
  tasks,
}: {
  tasks: Awaited<ReturnType<typeof loadTasks>>;
}) {
  return (
    <>
      {tasks.map((task) => {
        const urgency = taskUrgency(task);
        const due = dueDateLabel(task.dueDate);
        return (
          <DataTableRow
            key={task.id}
            className={cn("odd:bg-transparent", urgencyRowClass(urgency))}
          >
            <DataTableCell>
              {task.status !== "DONE" ? (
                <form action={completeTaskAction.bind(null, task.id)}>
                  <Button type="submit" size="sm" variant="ghost" title="Завершить">
                    ✓
                  </Button>
                </form>
              ) : null}
            </DataTableCell>
            <DataTableCell>
              <p className="font-medium text-foreground">{task.title}</p>
              {task.description ? (
                <p className="text-[11px] text-muted-foreground line-clamp-1">
                  {task.description}
                </p>
              ) : null}
            </DataTableCell>
            <DataTableCell>
              <Link
                href={`/admin/students/${task.studentId}`}
                className="font-medium hover:underline"
              >
                {fullName(task.student.firstName, task.student.lastName)}
              </Link>
            </DataTableCell>
            <DataTableCell className={cn("tabular-nums text-[12px]", due.className)}>
              {due.text}
            </DataTableCell>
            <DataTableCell>
              <PriorityCell priority={task.priority} />
            </DataTableCell>
            <DataTableCell>
              <StatusBadge status={task.status} kind="task" />
            </DataTableCell>
          </DataTableRow>
        );
      })}
    </>
  );
}

async function loadTasks(where: Prisma.TaskWhereInput) {
  return prisma.task.findMany({
    where,
    include: {
      student: { select: { id: true, firstName: true, lastName: true } },
      assignee: { select: { name: true } },
    },
  });
}

export default async function AdminTasksPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string }>;
}) {
  const session = await requireStaff();
  const params = await searchParams;
  const view = (
    VIEWS.some((v) => v.key === params.view) ? params.view : "my"
  ) as ViewKey;

  const scope = studentScopeWhere(session.user.id, session.user.role);
  const where = taskWhere(view, session.user.id, scope);
  const raw = await loadTasks(where);
  const tasks = sortTasksByUrgency(raw);
  const grouped = groupTasksByUrgency(tasks);
  const useGroups = view === "my";

  return (
    <div className="space-y-5">
      <PageHeader title="Задачи" description="Очередь работы по вашим студентам" />

      <div className="flex flex-wrap gap-1">
        {VIEWS.map((v) => (
          <Link
            key={v.key}
            href={`/admin/tasks?view=${v.key}`}
            className={cn(
              "rounded-md px-2.5 py-1 text-xs font-medium transition-colors",
              view === v.key
                ? "bg-[var(--brand)] text-white"
                : "bg-muted text-muted-foreground hover:text-foreground"
            )}
          >
            {v.label}
          </Link>
        ))}
      </div>

      {tasks.length === 0 ? (
        <EmptyState
          title="Здесь нет задач"
          description="Смените вид или создайте задачу в профиле студента."
        />
      ) : useGroups ? (
        <div className="space-y-5">
          {(
            [
              { key: "overdue", label: "Просрочено", list: grouped.overdue },
              { key: "today", label: "Сегодня", list: grouped.today },
              { key: "upcoming", label: "Далее", list: grouped.upcoming },
            ] as const
          ).map((group) =>
            group.list.length === 0 ? null : (
              <div key={group.key} className="space-y-2">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                  {group.label}
                  <span className="ml-1.5 font-normal tabular-nums">
                    ({group.list.length})
                  </span>
                </p>
                <DataTable>
                  <DataTableHeader>
                    <DataTableRow>
                      <DataTableHead className="w-10" />
                      <DataTableHead>Задача</DataTableHead>
                      <DataTableHead>Студент</DataTableHead>
                      <DataTableHead>Срок</DataTableHead>
                      <DataTableHead>Приоритет</DataTableHead>
                      <DataTableHead>Статус</DataTableHead>
                    </DataTableRow>
                  </DataTableHeader>
                  <DataTableBody>
                    <TaskRows tasks={group.list} />
                  </DataTableBody>
                </DataTable>
              </div>
            )
          )}
        </div>
      ) : (
        <DataTable>
          <DataTableHeader>
            <DataTableRow>
              <DataTableHead className="w-10" />
              <DataTableHead>Задача</DataTableHead>
              <DataTableHead>Студент</DataTableHead>
              <DataTableHead>Срок</DataTableHead>
              <DataTableHead>Приоритет</DataTableHead>
              <DataTableHead>Статус</DataTableHead>
            </DataTableRow>
          </DataTableHeader>
          <DataTableBody>
            <TaskRows tasks={tasks} />
          </DataTableBody>
        </DataTable>
      )}
    </div>
  );
}
