import { prisma } from "@/lib/db";
import { requireStaff, studentScopeWhere } from "@/server/auth/guards";
import {
  TasksTable,
  toTaskTableRow,
} from "@/components/admin/tasks-table";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/empty-state";
import { FilterPills } from "@/components/filter-pills";
import {
  groupTasksByUrgency,
  sortTasksByUrgency,
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
  studentScope: Prisma.StudentWhereInput,
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
  const rows = tasks.map(toTaskTableRow);

  return (
    <div className="space-y-5">
      <PageHeader title="Задачи" description="Очередь работы по вашим студентам" />

      <FilterPills
        activeId={view}
        items={VIEWS.map((v) => ({
          id: v.key,
          label: v.label,
          href: `/admin/tasks?view=${v.key}`,
        }))}
      />

      {tasks.length === 0 ? (
        <EmptyState
          title="Здесь нет задач"
          description="Смените вид или создайте задачу в профиле студента."
        />
      ) : useGroups ? (
        <TasksTable
          rows={rows}
          groups={(
            [
              { key: "overdue", label: "Просрочено", list: grouped.overdue },
              { key: "today", label: "Сегодня", list: grouped.today },
              { key: "upcoming", label: "Далее", list: grouped.upcoming },
            ] as const
          )
            .filter((group) => group.list.length > 0)
            .map((group) => ({
              key: group.key,
              label: group.label,
              rows: group.list.map(toTaskTableRow),
            }))}
        />
      ) : (
        <TasksTable rows={rows} />
      )}
    </div>
  );
}
