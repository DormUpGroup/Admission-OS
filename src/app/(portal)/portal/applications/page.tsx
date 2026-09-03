import { prisma } from "@/lib/db";
import { getCurrentStudent } from "@/server/auth/guards";
import { EmptyState } from "@/components/empty-state";
import { PortalUniversityCard } from "@/components/portal-university-card";

export default async function PortalApplicationsPage() {
  const { student } = await getCurrentStudent();

  const applications = await prisma.application.findMany({
    where: { studentId: student.id },
    include: { program: { include: { university: true } } },
    orderBy: { hardDeadline: "asc" },
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-[28px] font-semibold tracking-tight text-foreground">
          Подачи
        </h1>
        <p className="mt-1 text-[15px] text-muted-foreground">
          Университеты и программы, на которые вы подаётесь
        </p>
      </div>

      {applications.length === 0 ? (
        <EmptyState
          title="Пока нет подач"
          description="Куратор добавит подачи за вас."
        />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {applications.map((app) => (
            <PortalUniversityCard
              key={app.id}
              href={`/portal/applications/${app.id}`}
              universityName={app.program.university.name}
              programName={app.program.name}
              city={null}
              intake={app.intake}
              status={app.status}
              readinessPercent={app.readinessPercent}
              deadline={app.hardDeadline}
            />
          ))}
        </div>
      )}
    </div>
  );
}
