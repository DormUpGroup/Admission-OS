import Link from "next/link";
import { prisma } from "@/lib/db";
import { requireStaff, studentScopeWhere } from "@/server/auth/guards";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/empty-state";
import { DeadlineList } from "@/components/deadline-list";
import { cn, fullName } from "@/lib/utils";
import {
  addDays,
  endOfDay,
  isBefore,
  isSameDay,
  startOfDay,
} from "date-fns";

const RANGES = [
  { key: "7", label: "7 дней" },
  { key: "30", label: "30 дней" },
  { key: "all", label: "Все" },
] as const;

type RangeKey = (typeof RANGES)[number]["key"];

function groupDeadlines<T extends { date: Date }>(items: T[]) {
  const now = new Date();
  const tomorrow = addDays(startOfDay(now), 1);
  const weekEnd = endOfDay(addDays(startOfDay(now), 6));

  const groups: { label: string; items: T[] }[] = [
    { label: "Сегодня", items: [] },
    { label: "Завтра", items: [] },
    { label: "На этой неделе", items: [] },
    { label: "Позже", items: [] },
  ];

  for (const item of items) {
    const d = item.date;
    if (isSameDay(d, now)) groups[0].items.push(item);
    else if (isSameDay(d, tomorrow)) groups[1].items.push(item);
    else if (!isBefore(weekEnd, d) && isBefore(now, d)) groups[2].items.push(item);
    else groups[3].items.push(item);
  }

  return groups.filter((g) => g.items.length > 0);
}

export default async function AdminDeadlinesPage({
  searchParams,
}: {
  searchParams: Promise<{ range?: string }>;
}) {
  const session = await requireStaff();
  const params = await searchParams;
  const range = (
    RANGES.some((r) => r.key === params.range) ? params.range : "7"
  ) as RangeKey;

  const scope = studentScopeWhere(session.user.id, session.user.role);
  const now = startOfDay(new Date());
  const upper =
    range === "7"
      ? endOfDay(addDays(now, 7))
      : range === "30"
        ? endOfDay(addDays(now, 30))
        : undefined;

  const deadlines = await prisma.deadline.findMany({
    where: {
      student: scope,
      date: upper ? { gte: now, lte: upper } : { gte: now },
    },
    include: {
      student: { select: { id: true, firstName: true, lastName: true } },
    },
    orderBy: { date: "asc" },
  });

  const groups = groupDeadlines(deadlines);

  return (
    <div className="space-y-5">
      <PageHeader
        title="Дедлайны"
        description="Ближайшие жёсткие и мягкие дедлайны"
      />

      <div className="flex flex-wrap gap-1">
        {RANGES.map((r) => (
          <Link
            key={r.key}
            href={`/admin/deadlines?range=${r.key}`}
            className={cn(
              "rounded-md px-2.5 py-1 text-xs font-medium transition-colors",
              range === r.key
                ? "bg-[var(--brand)] text-white"
                : "bg-muted text-muted-foreground hover:text-foreground"
            )}
          >
            {r.label}
          </Link>
        ))}
      </div>

      {deadlines.length === 0 ? (
        <EmptyState
          title="Нет ближайших дедлайнов"
          description="Дедлайны, созданные по подачам, появятся здесь."
        />
      ) : (
        <div className="space-y-6">
          {groups.map((group) => (
            <section key={group.label} className="space-y-2">
              <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {group.label}
              </h2>
              <DeadlineList
                deadlines={group.items.map((d) => ({
                  id: d.id,
                  title: d.title,
                  dueDate: d.date,
                  type: d.type,
                  studentName: fullName(d.student.firstName, d.student.lastName),
                  href: `/admin/students/${d.studentId}`,
                }))}
              />
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
