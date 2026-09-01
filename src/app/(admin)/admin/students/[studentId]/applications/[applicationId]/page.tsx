import Link from "next/link";
import { notFound } from "next/navigation";
import { requireStaff, assertStudentAccess } from "@/server/auth/guards";
import { prisma } from "@/lib/db";
import { fullName, formatDate, cn } from "@/lib/utils";
import { criticalIncomplete } from "@/server/services/readiness";
import { activityLabel } from "@/server/services/activity";
import { addRequirementAction, createTaskAction } from "@/server/actions";
import { PageHeader } from "@/components/page-header";
import { MetricCard } from "@/components/metric-card";
import { RiskBadge } from "@/components/risk-badge";
import { StatusBadge } from "@/components/status-badge";
import { ProgressBar } from "@/components/progress-bar";
import { RequirementList } from "@/components/requirement-list";
import { TaskList } from "@/components/task-list";
import { ActivityTimeline } from "@/components/activity-timeline";
import { EmptyState } from "@/components/empty-state";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  DataTable,
  DataTableBody,
  DataTableCell,
  DataTableHead,
  DataTableHeader,
  DataTableRow,
} from "@/components/data-table";
import { labelOf } from "@/lib/labels";
import type { ActivityType } from "@/lib/enums";
import { SubmitApplicationForm } from "./submit-form";

const TABS = [
  { id: "overview", label: "Обзор" },
  { id: "requirements", label: "Требования" },
  { id: "tasks", label: "Задачи" },
  { id: "submission", label: "Подача" },
  { id: "timeline", label: "Хронология" },
] as const;

export default async function ApplicationDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ studentId: string; applicationId: string }>;
  searchParams: Promise<{ tab?: string }>;
}) {
  await requireStaff();
  const { studentId, applicationId } = await params;
  const sp = await searchParams;
  const tab = TABS.some((t) => t.id === sp.tab) ? sp.tab! : "overview";

  await assertStudentAccess(studentId);

  const app = await prisma.application.findFirst({
    where: { id: applicationId, studentId },
    include: {
      student: true,
      program: { include: { university: true } },
      requirements: { orderBy: [{ isCritical: "desc" }, { name: "asc" }] },
      tasks: {
        where: { status: { not: "DONE" } },
        orderBy: [{ dueDate: "asc" }, { createdAt: "desc" }],
      },
      activities: {
        include: { user: true },
        orderBy: { createdAt: "desc" },
        take: 40,
      },
      deadlines: { orderBy: { date: "asc" } },
    },
  });

  if (!app) notFound();

  const blockers = criticalIncomplete(app.requirements);
  const base = `/admin/students/${studentId}/applications/${applicationId}`;

  return (
    <div className="space-y-5">
      <div className="text-[11px] text-muted-foreground">
        <Link href="/admin/students" className="hover:underline">
          Студенты
        </Link>
        {" / "}
        <Link
          href={`/admin/students/${studentId}`}
          className="hover:underline"
        >
          {fullName(app.student.firstName, app.student.lastName)}
        </Link>
        {" / "}
        <span className="text-foreground">{app.program.name}</span>
      </div>

      <PageHeader
        title={`${app.program.university.name} — ${app.program.name}`}
        description={`Набор ${app.intake}${
          app.hardDeadline ? ` · Жёсткий дедлайн ${formatDate(app.hardDeadline)}` : ""
        }`}
        actions={
          <>
            <StatusBadge status={app.status} kind="application" />
            <RiskBadge level={app.riskLevel} />
          </>
        }
      />

      <div className="grid gap-3 sm:grid-cols-3">
        <MetricCard
          label="Готовность"
          value={`${app.readinessPercent}%`}
          hint="Выполненные требования"
        />
        <MetricCard
          label="Что мешает"
          value={blockers.length}
          hint={blockers.length ? blockers.map((b) => b.name).join(", ") : "Всё закрыто"}
        />
        <MetricCard
          label="Открытые задачи"
          value={app.tasks.length}
        />
      </div>

      <div>
        <ProgressBar value={app.readinessPercent} showLabel size="md" />
      </div>

      {blockers.length > 0 ? (
        <div className="rounded-md border border-orange-200 bg-orange-50 px-3 py-2 text-xs text-orange-900">
          <span className="font-medium">Что мешает: </span>
          {blockers.map((b) => b.name).join(", ")}
        </div>
      ) : null}

      <div className="flex flex-wrap gap-1 border-b border-border pb-px">
        {TABS.map((t) => (
          <Link
            key={t.id}
            href={`${base}?tab=${t.id}`}
            className={cn(
              "-mb-px border-b-2 px-3 py-2 text-xs font-medium transition-colors",
              tab === t.id
                ? "border-neutral-900 text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground"
            )}
          >
            {t.label}
          </Link>
        ))}
      </div>

      {tab === "overview" ? (
        <div className="grid gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>Детали</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-[13px]">
              <Row label="Студент" value={fullName(app.student.firstName, app.student.lastName)} />
              <Row label="Университет" value={app.program.university.name} />
              <Row label="Программа" value={app.program.name} />
              <Row label="Раунд" value={app.applicationRound ?? "—"} />
              <Row label="Тип поступления" value={app.admissionType ?? "—"} />
              <Row label="Требуемый экзамен" value={app.requiredExam ?? "—"} />
              <Row label="Английский" value={app.requiredEnglish ?? "—"} />
              <Row label="Сбор" value={app.applicationFee ?? "—"} />
              <Row
                label="Целевая подача"
                value={formatDate(app.targetSubmissionDate)}
              />
              <Row label="Подана" value={formatDate(app.submittedAt)} />
              <Row
                label="Внешний ID"
                value={app.applicationIdExternal ?? "—"}
              />
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Обязательные требования</CardTitle>
            </CardHeader>
            <CardContent>
              <RequirementList
                requirements={app.requirements
                  .filter((r) => r.isCritical)
                  .map((r) => ({
                    id: r.id,
                    title: r.name,
                    status: r.status,
                    type: r.type,
                    required: r.isCritical,
                  }))}
                emptyMessage="Нет обязательных требований"
              />
            </CardContent>
          </Card>
        </div>
      ) : null}

      {tab === "requirements" ? (
        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Добавить требование</CardTitle>
            </CardHeader>
            <CardContent>
              <form
                action={addRequirementAction}
                className="flex flex-wrap items-end gap-2"
              >
                <input type="hidden" name="applicationId" value={applicationId} />
                <div className="min-w-[160px] flex-1 space-y-1.5">
                  <Label htmlFor="name">Название</Label>
                  <Input id="name" name="name" required />
                </div>
                <div className="w-[140px] space-y-1.5">
                  <Label htmlFor="type">Тип</Label>
                  <select
                    id="type"
                    name="type"
                    defaultValue="DOCUMENT"
                    className="flex h-8 w-full rounded-md border border-input bg-card px-2 text-[13px]"
                  >
                    <option value="DOCUMENT">Документ</option>
                    <option value="EXAM">Экзамен</option>
                    <option value="LANGUAGE">Язык</option>
                    <option value="TASK">Задача</option>
                    <option value="PAYMENT">Оплата</option>
                    <option value="OTHER">Другое</option>
                  </select>
                </div>
                <label className="flex items-center gap-2 pb-2 text-xs">
                  <input type="checkbox" name="isCritical" />
                  Обязательное
                </label>
                <Button type="submit" size="sm">
                  Добавить
                </Button>
              </form>
            </CardContent>
          </Card>

          <DataTable>
            <DataTableHeader>
              <DataTableRow>
                <DataTableHead>Требование</DataTableHead>
                <DataTableHead>Тип</DataTableHead>
                <DataTableHead>Обязательное</DataTableHead>
                <DataTableHead>Статус</DataTableHead>
                <DataTableHead>Срок</DataTableHead>
              </DataTableRow>
            </DataTableHeader>
            <DataTableBody>
              {app.requirements.map((r) => (
                <DataTableRow key={r.id}>
                  <DataTableCell className="font-medium">{r.name}</DataTableCell>
                  <DataTableCell className="text-muted-foreground">
                    {labelOf(r.type)}
                  </DataTableCell>
                  <DataTableCell>
                    {r.isCritical ? (
                      <span className="text-orange-700">Да</span>
                    ) : (
                      "—"
                    )}
                  </DataTableCell>
                  <DataTableCell>
                    <StatusBadge status={r.status} kind="requirement" />
                  </DataTableCell>
                  <DataTableCell className="tabular-nums text-muted-foreground">
                    {formatDate(r.dueDate)}
                  </DataTableCell>
                </DataTableRow>
              ))}
            </DataTableBody>
          </DataTable>
        </div>
      ) : null}

      {tab === "tasks" ? (
        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Создать задачу</CardTitle>
            </CardHeader>
            <CardContent>
              <form
                action={createTaskAction}
                className="grid gap-3 sm:grid-cols-2"
              >
                <input type="hidden" name="studentId" value={studentId} />
                <input type="hidden" name="applicationId" value={applicationId} />
                <div className="space-y-1.5 sm:col-span-2">
                  <Label htmlFor="title">Название</Label>
                  <Input id="title" name="title" required />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="dueDate">Срок</Label>
                  <Input id="dueDate" name="dueDate" type="date" />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="priority">Приоритет</Label>
                  <select
                    id="priority"
                    name="priority"
                    defaultValue="MEDIUM"
                    className="flex h-8 w-full rounded-md border border-input bg-card px-2.5 text-[13px]"
                  >
                    <option value="LOW">Низкий</option>
                    <option value="MEDIUM">Средний</option>
                    <option value="HIGH">Высокий</option>
                    <option value="URGENT">Срочный</option>
                  </select>
                </div>
                <label className="flex items-center gap-2 self-end pb-2 text-xs">
                  <input type="checkbox" name="isStudentFacing" />
                  Видно студенту
                </label>
                <div className="sm:col-span-2">
                  <Button type="submit" size="sm">
                    Создать задачу
                  </Button>
                </div>
              </form>
            </CardContent>
          </Card>
          <TaskList
            tasks={app.tasks.map((t) => ({
              id: t.id,
              title: t.title,
              status: t.status,
              priority: t.priority,
              dueDate: t.dueDate,
            }))}
          />
        </div>
      ) : null}

      {tab === "submission" ? (
        <Card>
          <CardHeader>
            <CardTitle>Отметить как поданную</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {app.status === "SUBMITTED" ||
            app.status === "WAITING_RESULT" ||
            app.submittedAt ? (
              <EmptyState
                title="Уже подана"
                description={`Подана ${formatDate(app.submittedAt)}. Внешний ID: ${
                  app.applicationIdExternal ?? "—"
                }`}
                className="py-6"
              />
            ) : (
              <SubmitApplicationForm
                applicationId={applicationId}
                hasBlockers={blockers.length > 0}
                blockerNames={blockers.map((b) => b.name)}
              />
            )}
          </CardContent>
        </Card>
      ) : null}

      {tab === "timeline" ? (
        <Card>
          <CardHeader>
            <CardTitle>Хронология</CardTitle>
          </CardHeader>
          <CardContent>
            <ActivityTimeline
              items={app.activities.map((a) => ({
                id: a.id,
                type: a.type,
                title: activityLabel(a.type as ActivityType, a.metadata),
                description: a.metadata,
                actorName: a.user?.name,
                createdAt: a.createdAt,
              }))}
            />
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-4 border-b border-border/60 py-1.5 last:border-0">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-right font-medium">{value}</span>
    </div>
  );
}
