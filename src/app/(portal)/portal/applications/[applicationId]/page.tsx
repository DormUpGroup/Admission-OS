import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { getCurrentStudent } from "@/server/auth/guards";
import { criticalIncomplete } from "@/server/services/readiness";
import { StatusBadge } from "@/components/status-badge";
import { ProgressBar } from "@/components/progress-bar";
import { RequirementList } from "@/components/requirement-list";
import { EmptyState } from "@/components/empty-state";
import { formatDate, cn } from "@/lib/utils";
import { labelOf } from "@/lib/labels";
import {
  ArrowLeft,
  CalendarDays,
  ExternalLink,
  MapPin,
} from "lucide-react";

function InfoRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-4 border-b border-[var(--border)]/60 py-2.5 last:border-0">
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className="text-right text-sm font-medium text-[var(--foreground)]">{value}</span>
    </div>
  );
}

function Section({
  title,
  children,
  className,
}: {
  title: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("rounded-2xl border border-[var(--border)] bg-white", className)}>
      <h2 className="border-b border-[var(--border)] px-4 py-3 text-sm font-semibold text-[var(--brand)]">
        {title}
      </h2>
      <div className="px-4 py-3">{children}</div>
    </section>
  );
}

export default async function PortalApplicationDetailPage({
  params,
}: {
  params: Promise<{ applicationId: string }>;
}) {
  const { student } = await getCurrentStudent();
  const { applicationId } = await params;

  const app = await prisma.application.findFirst({
    where: { id: applicationId, studentId: student.id },
    include: {
      program: { include: { university: true } },
      requirements: { orderBy: [{ isCritical: "desc" }, { name: "asc" }] },
      tasks: {
        where: { isStudentFacing: true, status: { not: "DONE" } },
        orderBy: [{ dueDate: "asc" }, { createdAt: "desc" }],
      },
      deadlines: { orderBy: { date: "asc" } },
    },
  });

  if (!app) notFound();

  const { program } = app;
  const { university } = program;
  const blockers = criticalIncomplete(app.requirements);

  return (
    <div className="space-y-6">
      <Link
        href="/portal/applications"
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-[var(--brand)]"
      >
        <ArrowLeft className="h-4 w-4" />
        Все подачи
      </Link>

      <div className="overflow-hidden rounded-2xl border border-[var(--border)] bg-white">
        <div className="border-b border-[var(--border)] bg-[var(--brand-soft)] px-4 py-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h1 className="text-lg font-semibold leading-snug text-[var(--brand)]">
                {university.name}
              </h1>
              <p className="mt-1 text-sm font-medium text-[var(--foreground)]">{program.name}</p>
              <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                {university.city ? (
                  <span className="inline-flex items-center gap-1">
                    <MapPin className="h-3 w-3" />
                    {university.city}
                    {university.region ? `, ${university.region}` : ""}
                  </span>
                ) : null}
                {university.website ? (
                  <a
                    href={university.website}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-[var(--brand)] hover:underline"
                  >
                    Сайт университета
                    <ExternalLink className="h-3 w-3" />
                  </a>
                ) : null}
              </div>
            </div>
            <StatusBadge status={app.status} kind="application" />
          </div>
        </div>

        <div className="space-y-4 px-4 py-4">
          <ProgressBar value={app.readinessPercent} showLabel size="md" />

          {blockers.length > 0 ? (
            <div className="rounded-xl border border-[var(--brand-muted)] bg-[var(--brand-soft)] px-3 py-2.5 text-sm text-[var(--foreground)]">
              <span className="font-medium text-[var(--brand)]">Что осталось: </span>
              {blockers.map((b) => b.name).join(", ")}
            </div>
          ) : null}
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Section title="О программе">
          <InfoRow label="Степень" value={labelOf(program.degreeLevel)} />
          <InfoRow label="Язык обучения" value={program.language ?? "—"} />
          <InfoRow label="Направление" value={program.field ?? "—"} />
          {program.notes ? (
            <p className="mt-3 text-sm leading-relaxed text-muted-foreground">{program.notes}</p>
          ) : null}
        </Section>

        <Section title="Условия поступления">
          <InfoRow label="Набор" value={app.intake} />
          <InfoRow label="Раунд подачи" value={app.applicationRound ?? "—"} />
          <InfoRow label="Тип поступления" value={app.admissionType ?? "—"} />
          <InfoRow
            label="Экзамен"
            value={app.requiredExam ?? "—"}
          />
          <InfoRow
            label="Английский"
            value={app.requiredEnglish ?? "—"}
          />
          <InfoRow label="Сбор за подачу" value={app.applicationFee ?? "—"} />
          <InfoRow
            label="Сбор оплачен"
            value={app.applicationFeePaid ? "Да" : "Нет"}
          />
        </Section>
      </div>

      <Section title="Сроки">
        <InfoRow
          label="Жёсткий дедлайн"
          value={
            app.hardDeadline ? (
              <span className="inline-flex items-center gap-1">
                <CalendarDays className="h-3.5 w-3.5 text-[var(--brand)]" />
                {formatDate(app.hardDeadline)}
              </span>
            ) : (
              "—"
            )
          }
        />
        <InfoRow
          label="Целевая дата подачи"
          value={formatDate(app.targetSubmissionDate)}
        />
        <InfoRow label="Фактическая подача" value={formatDate(app.submittedAt)} />
        {app.submittedAt && app.applicationIdExternal ? (
          <InfoRow label="Номер подачи" value={app.applicationIdExternal} />
        ) : null}
      </Section>

      <Section title="Требования к подаче">
        {app.requirements.length === 0 ? (
          <EmptyState
            title="Требования ещё не добавлены"
            description="Куратор настроит список документов и шагов."
            className="py-6"
          />
        ) : (
          <RequirementList
            requirements={app.requirements.map((r) => ({
              id: r.id,
              title: r.name,
              status: r.status,
              type: r.type,
              required: r.isCritical,
            }))}
          />
        )}
      </Section>

      {app.tasks.length > 0 ? (
        <Section title="Ваши задачи">
          <ul className="divide-y divide-[var(--border)]">
            {app.tasks.map((task) => (
              <li key={task.id} className="py-3 first:pt-0 last:pb-0">
                <p className="text-sm font-medium text-[var(--foreground)]">{task.title}</p>
                {task.description ? (
                  <p className="mt-1 text-sm text-muted-foreground">{task.description}</p>
                ) : null}
                {task.dueDate ? (
                  <p className="mt-1 text-xs text-muted-foreground">
                    Срок: {formatDate(task.dueDate)}
                  </p>
                ) : null}
              </li>
            ))}
          </ul>
          <Link
            href="/portal/tasks"
            className="mt-3 inline-block text-xs text-[var(--brand)] hover:underline"
          >
            Все задачи →
          </Link>
        </Section>
      ) : null}

      {app.deadlines.length > 0 ? (
        <Section title="Связанные дедлайны">
          <ul className="space-y-2">
            {app.deadlines.map((d) => (
              <li
                key={d.id}
                className="flex items-center justify-between gap-3 rounded-lg bg-[var(--brand-soft)] px-3 py-2"
              >
                <span className="text-sm text-[var(--foreground)]">{d.title}</span>
                <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                  {formatDate(d.date)}
                </span>
              </li>
            ))}
          </ul>
        </Section>
      ) : null}
    </div>
  );
}
