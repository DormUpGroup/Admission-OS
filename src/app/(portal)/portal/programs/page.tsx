import Link from "next/link";
import { prisma } from "@/lib/db";
import { getCurrentStudent } from "@/server/auth/guards";
import { requestApplicationAction } from "@/server/actions";
import { hasMatchingProfile } from "@/server/services/program-match";
import { matchProgramsFromShortlist } from "@/server/services/program-match";
import { EmptyState } from "@/components/empty-state";
import { PortalUniversityCard } from "@/components/portal-university-card";
import { ProgramMatchCard } from "@/components/program-match-card";
import { Button } from "@/components/ui/button";

export default async function PortalProgramsPage() {
  const { student } = await getCurrentStudent();

  if (!hasMatchingProfile(student)) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-lg font-semibold tracking-tight">Программы</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Рекомендации появятся после анкеты по подбору программ
          </p>
        </div>
        <EmptyState
          title="Сначала заполните анкету №2"
          description="Анкета по подбору программ нужна, чтобы мы могли подготовить список вузов."
        />
        <Button asChild className="h-11 sm:h-9">
          <Link href="/portal/questionnaire-2">Открыть анкету №2</Link>
        </Button>
      </div>
    );
  }

  const [matches, applications] = await Promise.all([
    matchProgramsFromShortlist(student.id),
    prisma.application.findMany({
      where: { studentId: student.id },
      include: { program: { include: { university: true } } },
      orderBy: { createdAt: "asc" },
    }),
  ]);

  const empty = matches.length === 0 && applications.length === 0;

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold tracking-tight text-[var(--foreground)]">
            Программы
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Выбранные и рекомендованные программы
            {student.targetField ? ` · ${student.targetField}` : ""}
            {student.preferredLanguage ? ` · ${student.preferredLanguage}` : ""}
          </p>
        </div>
        <Button asChild variant="outline" size="sm" className="h-11 sm:h-8">
          <Link href="/portal/questionnaire-2">Изменить анкету №2</Link>
        </Button>
      </div>

      {empty ? (
        <EmptyState
          title="Список пока пуст"
          description="Куратор ещё готовит программы. Мы сообщим, когда можно будет выбирать."
        />
      ) : null}

      {applications.length > 0 ? (
        <section className="space-y-3">
          <h2 className="text-sm font-semibold text-[var(--foreground)]">
            Выбрано
          </h2>
          <div className="grid gap-4 sm:grid-cols-2">
            {applications.map((app) => (
              <PortalUniversityCard
                key={app.id}
                href={`/portal/applications/${app.id}`}
                universityName={app.program.university.name}
                programName={app.program.name}
                city={app.program.university.city}
                intake={app.intake}
                status={app.status}
                readinessPercent={app.readinessPercent}
                deadline={app.hardDeadline}
              />
            ))}
          </div>
        </section>
      ) : null}

      {matches.length > 0 ? (
        <section className="space-y-3">
          <h2 className="text-sm font-semibold text-[var(--foreground)]">
            Рекомендованные
          </h2>
          <div className="grid gap-4 sm:grid-cols-2">
            {matches.map((m) => (
              <ProgramMatchCard
                key={m.programId}
                match={m}
                action={
                  m.alreadyApplied && m.applicationId ? (
                    <Button asChild size="sm" variant="outline" className="w-full">
                      <Link href={`/portal/applications/${m.applicationId}`}>
                        Открыть заявку
                      </Link>
                    </Button>
                  ) : (
                    <form action={requestApplicationAction}>
                      <input type="hidden" name="programId" value={m.programId} />
                      <Button type="submit" size="sm" className="w-full h-11 sm:h-8">
                        Хочу подать
                      </Button>
                    </form>
                  )
                }
              />
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}
