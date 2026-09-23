import { prisma } from "@/lib/db";
import { backendFetch, isBackendCapabilityEnabled } from "@/lib/backend-api";
import { getCurrentStudent } from "@/server/auth/guards";
import { DeadlineList } from "@/components/deadline-list";
import { EmptyState } from "@/components/empty-state";

export default async function PortalDeadlinesPage() {
  const { session, student } = await getCurrentStudent();

  let deadlines: Array<{ id: string; title: string; date: Date; type: string }>;
  if (isBackendCapabilityEnabled("reads")) {
    const response = await backendFetch(session.user, "/v1/deadlines");
    if (!response.ok) throw new Error("Не удалось загрузить дедлайны");
    const payload = (await response.json()) as Array<{
      id: string;
      title: string;
      date: string;
      type: string;
    }>;
    deadlines = payload.map((deadline) => ({
      ...deadline,
      date: new Date(deadline.date),
    }));
  } else {
    deadlines = await prisma.deadline.findMany({
      where: {
        studentId: student.id,
        isInternal: false,
        date: { gte: new Date(new Date().setHours(0, 0, 0, 0)) },
      },
      orderBy: { date: "asc" },
    });
  }

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
