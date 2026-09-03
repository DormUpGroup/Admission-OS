import { prisma } from "@/lib/db";
import { getCurrentStudent } from "@/server/auth/guards";
import { DeadlineList } from "@/components/deadline-list";
import { EmptyState } from "@/components/empty-state";

export default async function PortalDeadlinesPage() {
  const { student } = await getCurrentStudent();

  const deadlines = await prisma.deadline.findMany({
    where: {
      studentId: student.id,
      isInternal: false,
      date: { gte: new Date(new Date().setHours(0, 0, 0, 0)) },
    },
    orderBy: { date: "asc" },
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-[28px] font-semibold tracking-tight">Дедлайны</h1>
        <p className="mt-1 text-[15px] text-muted-foreground">
          Важные даты по вашим подачам
        </p>
      </div>

      {deadlines.length === 0 ? (
        <EmptyState
          title="Нет ближайших дедлайнов"
          description="Дедлайны по подачам появятся здесь."
        />
      ) : (
        <DeadlineList
          deadlines={deadlines.map((d) => ({
            id: d.id,
            title: d.title,
            dueDate: d.date,
            type: d.type,
          }))}
        />
      )}
    </div>
  );
}
