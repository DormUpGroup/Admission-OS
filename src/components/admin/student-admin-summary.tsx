import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { assignStudentToMeAction } from "@/server/actions";
import { ChangeCuratorForm } from "@/components/admin/change-curator-form";
import { RemindStudentDocumentsBlock } from "@/components/admin/remind-student-documents-block";
import {
  documentIdFromWaitingTaskId,
  remindLabelFromReason,
} from "@/components/admin/remind-student-documents";
import { RequestQuestionnaireButton } from "@/components/admin/request-questionnaire-button";
import { taskTitleAfterCuratorAssigned } from "@/server/services/assign-curator";
import type { MissingQuestionnaire } from "@/server/registration/cabinet";
import type { WorkQueueItem } from "@/server/services/work-queue";
import type { JourneyStageId } from "@/server/services/student-journey/types";
import { WORK_QUEUE_STAGE_LABELS } from "@/server/services/work-queue/types";

function facingTitle(title: string, curatorAssigned: boolean) {
  if (!curatorAssigned) return title;
  const next = taskTitleAfterCuratorAssigned(title);
  return next === "DONE" ? null : next;
}

export function StudentAdminSummary({
  studentId,
  stage,
  nextStep,
  curatorName,
  curatorAssigned,
  canAssignToMe,
  canAssignCurator,
  curators,
  currentCuratorId,
  programsCount,
  documentsApproved,
  documentsTotal,
  applicationsCount,
  nearestDeadline,
  openTasks,
  missingQuestionnaire: missingQ = null,
}: {
  studentId: string;
  stage: JourneyStageId;
  nextStep: string;
  curatorName: string | null;
  curatorAssigned: boolean;
  canAssignToMe: boolean;
  canAssignCurator?: boolean;
  curators?: Array<{ id: string; name: string }>;
  currentCuratorId?: string | null;
  programsCount: number;
  documentsApproved: number;
  documentsTotal: number;
  applicationsCount: number;
  nearestDeadline: string | null;
  openTasks: WorkQueueItem[];
  missingQuestionnaire?: MissingQuestionnaire | null;
}) {
  const step = facingTitle(nextStep, curatorAssigned) ?? "Нет следующего шага";
  const remindItems = openTasks.flatMap((task) => {
    if (task.type !== "WAITING_DOCUMENT") return [];
    const documentId = documentIdFromWaitingTaskId(task.id);
    if (!documentId) return [];
    return [
      {
        documentId,
        label: remindLabelFromReason(task.reason),
      },
    ];
  });
  const tasks = openTasks.flatMap((task) => {
    if (task.type === "WAITING_DOCUMENT") return [];
    const action = facingTitle(task.action, curatorAssigned);
    if (!action) return [];
    return [{ ...task, action }];
  });

  const metrics = [
    { label: "Этап", value: WORK_QUEUE_STAGE_LABELS[stage] },
    { label: "Программы", value: String(programsCount) },
    {
      label: "Документы",
      value: documentsTotal > 0 ? `${documentsApproved}/${documentsTotal}` : "—",
    },
    { label: "Заявки", value: String(applicationsCount) },
    { label: "Дедлайн", value: nearestDeadline ?? "—" },
  ];

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <CardTitle>Сводка</CardTitle>
          <div className="flex flex-wrap gap-2">
            <Button asChild size="sm" className="rounded-lg">
              <Link href={`/admin/messages/site?studentId=${studentId}`}>
                Написать студенту
              </Link>
            </Button>
            {canAssignToMe ? (
              <form action={assignStudentToMeAction}>
                <input type="hidden" name="studentId" value={studentId} />
                <Button type="submit" size="sm" variant="outline" className="rounded-lg">
                  Назначить себе
                </Button>
              </form>
            ) : null}
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-5">
        <section className="rounded-lg border border-border bg-muted/40 px-4 py-3">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            Следующий шаг
          </p>
          <p className="mt-1 text-[15px] font-medium leading-snug text-foreground">{step}</p>
        </section>

        {missingQ ? (
          <section className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border px-4 py-3">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                Анкеты на платформе
              </p>
              <p className="mt-1 text-[14px] font-medium">
                {missingQ === "personal"
                  ? "Не заполнена анкета №1"
                  : "Не заполнена анкета №2"}
              </p>
              <p className="mt-0.5 text-[13px] text-muted-foreground">
                Отправим ученику ссылку в кабинет или на создание кабинета.
              </p>
            </div>
            <RequestQuestionnaireButton studentId={studentId} />
          </section>
        ) : null}

        <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          {metrics.map((metric) => (
            <div
              key={metric.label}
              className="rounded-lg border border-border px-3 py-2.5"
            >
              <p className="text-[11px] text-muted-foreground">{metric.label}</p>
              <p className="mt-0.5 text-[14px] font-medium">{metric.value}</p>
            </div>
          ))}
        </section>

        <section className="rounded-lg border border-border px-4 py-3">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                Куратор
              </p>
              <p className="mt-1 text-[15px] font-medium">
                {curatorAssigned && curatorName ? curatorName : "Не назначен"}
              </p>
            </div>
            {canAssignCurator && curators && curators.length > 0 ? (
              <ChangeCuratorForm
                key={currentCuratorId ?? "none"}
                studentId={studentId}
                curators={curators}
                currentCuratorId={currentCuratorId ?? null}
                curatorAssigned={curatorAssigned}
              />
            ) : null}
          </div>
        </section>

        <RemindStudentDocumentsBlock
          key={remindItems.map((item) => item.documentId).join(",")}
          studentId={studentId}
          items={remindItems}
        />

        <section>
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            Открытые задачи
          </p>
          {tasks.length === 0 ? (
            <p className="rounded-lg border border-dashed border-border px-4 py-3 text-sm text-muted-foreground">
              Нет открытых задач
            </p>
          ) : (
            <ul className="divide-y divide-border rounded-lg border border-border">
              {tasks.slice(0, 6).map((task) => (
                <li
                  key={task.id}
                  className="flex items-center justify-between gap-3 px-4 py-3"
                >
                  <div className="min-w-0">
                    <p className="text-[14px] font-medium leading-snug">{task.action}</p>
                    {task.reason && task.reason !== "открытая задача куратора" ? (
                      <p className="mt-0.5 text-[12px] text-muted-foreground">{task.reason}</p>
                    ) : null}
                  </div>
                  <Button asChild size="sm" variant="outline" className="shrink-0 rounded-lg">
                    <Link href={task.href}>Открыть</Link>
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </section>
      </CardContent>
    </Card>
  );
}
