import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { assignStudentToMeAction } from "@/server/actions";
import type { WorkQueueItem } from "@/server/services/work-queue";
import type { JourneyStageId } from "@/server/services/student-journey/types";
import { WORK_QUEUE_STAGE_LABELS } from "@/server/services/work-queue/types";

export function StudentAdminSummary({
  studentId,
  stage,
  nextStep,
  curatorName,
  curatorAssigned,
  canAssignToMe,
  programsCount,
  documentsApproved,
  documentsTotal,
  applicationsCount,
  nearestDeadline,
  openTasks,
}: {
  studentId: string;
  stage: JourneyStageId;
  nextStep: string;
  curatorName: string | null;
  curatorAssigned: boolean;
  canAssignToMe: boolean;
  programsCount: number;
  documentsApproved: number;
  documentsTotal: number;
  applicationsCount: number;
  nearestDeadline: string | null;
  openTasks: WorkQueueItem[];
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Сводка</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <div>
            <dt className="text-[11px] text-muted-foreground">Текущий этап</dt>
            <dd className="text-sm font-medium">
              {WORK_QUEUE_STAGE_LABELS[stage]}
            </dd>
          </div>
          <div>
            <dt className="text-[11px] text-muted-foreground">Следующий шаг</dt>
            <dd className="text-sm font-medium">{nextStep}</dd>
          </div>
          <div>
            <dt className="text-[11px] text-muted-foreground">Куратор</dt>
            <dd className="text-sm font-medium">
              {curatorAssigned && curatorName
                ? curatorName
                : "Не назначен"}
            </dd>
          </div>
          <div>
            <dt className="text-[11px] text-muted-foreground">Программы</dt>
            <dd className="text-sm font-medium">{programsCount} в shortlist</dd>
          </div>
          <div>
            <dt className="text-[11px] text-muted-foreground">Документы</dt>
            <dd className="text-sm font-medium">
              {documentsApproved}/{documentsTotal}
            </dd>
          </div>
          <div>
            <dt className="text-[11px] text-muted-foreground">Заявки</dt>
            <dd className="text-sm font-medium">{applicationsCount}</dd>
          </div>
          <div className="sm:col-span-2">
            <dt className="text-[11px] text-muted-foreground">
              Ближайший подтверждённый дедлайн
            </dt>
            <dd className="text-sm font-medium">{nearestDeadline ?? "Нет"}</dd>
          </div>
        </dl>

        <div>
          <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            Открытые задачи
          </p>
          {openTasks.length === 0 ? (
            <p className="text-sm text-muted-foreground">Нет открытых задач</p>
          ) : (
            <ul className="space-y-1.5">
              {openTasks.slice(0, 6).map((task) => (
                <li
                  key={task.id}
                  className="flex flex-wrap items-center justify-between gap-2 text-sm"
                >
                  <span>
                    {task.action}
                    <span className="text-muted-foreground"> · {task.reason}</span>
                  </span>
                  <Button asChild size="sm" variant="outline">
                    <Link href={task.href}>Открыть</Link>
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="flex flex-wrap gap-2">
          <Button asChild size="sm">
            <Link href={`/admin/messages?studentId=${studentId}`}>
              Написать студенту
            </Link>
          </Button>
          {canAssignToMe ? (
            <form action={assignStudentToMeAction}>
              <input type="hidden" name="studentId" value={studentId} />
              <Button type="submit" size="sm" variant="outline">
                Назначить себе
              </Button>
            </form>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}
