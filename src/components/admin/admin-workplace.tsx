import Link from "next/link";
import { AlertTriangle, Clock3 } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatDate } from "@/lib/utils";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/empty-state";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toneForStatus } from "@/lib/status-tones";
import { acceptAccompanimentAction } from "@/server/actions";
import type { AdminHomeView } from "@/server/services/accompaniment";
import type { WorkQueueView } from "@/server/services/work-queue";

export function AdminWorkplaceScreen({
  view,
  query,
}: {
  view: AdminHomeView;
  query: {
    intake?: string;
    status?: string;
    curatorId?: string;
    studyLevel?: string;
  };
}) {
  return (
    <div className="mx-auto max-w-5xl space-y-8">
      <PageHeader
        title="Рабочая очередь"
        description="Кого принять на сопровождение и кому помочь сегодня"
        meta={
          <>
            <span className="tabular-nums">
              Новые анкеты:{" "}
              <span className="font-semibold text-foreground">
                {view.newAnketas.length}
              </span>
            </span>
            <span className="text-[var(--divider)]">·</span>
            <span className="tabular-nums">
              Действий сегодня:{" "}
              <span className="font-semibold text-foreground">
                {view.todayActionCount}
              </span>
            </span>
          </>
        }
      />

      {view.canEditLimit ? <CohortBlock view={view} /> : null}
      <NewAnketasBlock view={view} query={query} />
      <TodayActionsBlock queue={view.workQueue} count={view.todayActionCount} />
    </div>
  );
}

function CohortBlock({ view }: { view: AdminHomeView }) {
  const { cohort, allCohorts } = view;

  return (
    <section className="rounded-[var(--radius-card)] border border-border bg-card px-5 py-4">
      <div className="flex flex-col gap-1 sm:flex-row sm:items-baseline sm:justify-between">
        <h2 className="text-[15px] font-semibold text-foreground">
          Набор на сопровождение
        </h2>
        {allCohorts.length > 1 ? (
          <div className="flex flex-wrap gap-x-3 gap-y-1 text-[12px] text-muted-foreground">
            {allCohorts.map((item) => (
              <Link
                key={item.intake}
                href={`/admin?intake=${encodeURIComponent(item.intake)}`}
                className={cn(
                  "hover:text-foreground",
                  item.intake === cohort.intake && "font-medium text-foreground"
                )}
              >
                {item.label}
                {item.isActive ? " · текущий" : ""}
              </Link>
            ))}
          </div>
        ) : null}
      </div>

      <p className="mt-3 text-[14px] font-medium text-foreground">
        Набор {cohort.label}
      </p>
      <dl className="mt-3 grid gap-3 sm:grid-cols-3">
        <Metric
          label="Принято на сопровождение"
          value={cohort.occupied}
        />
        <Metric
          label="Лимит"
          value={cohort.limitUnset ? "Не задан" : cohort.limit}
        />
        <Metric
          label="Осталось мест"
          value={cohort.limitUnset ? "—" : cohort.remaining}
          tone={
            !cohort.limitUnset && Number(cohort.remaining) <= 0
              ? "danger"
              : "neutral"
          }
        />
      </dl>
      {cohort.fullReason ? (
        <p className="mt-3 flex items-start gap-1.5 text-[13px] text-[var(--danger-fg)]">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          {cohort.fullReason}
        </p>
      ) : null}
      {view.canEditLimit ? (
        <p className="mt-3 text-[12px] text-muted-foreground">
          Лимит задаётся в{" "}
          <Link
            href="/admin/settings"
            className="text-[var(--brand-fg)] underline-offset-2 hover:underline"
          >
            настройках
          </Link>
          .
        </p>
      ) : null}
    </section>
  );
}

function Metric({
  label,
  value,
  tone = "neutral",
}: {
  label: string;
  value: string | number | null | undefined;
  tone?: "neutral" | "danger";
}) {
  return (
    <div className="rounded-[var(--radius-control)] bg-muted/70 px-3 py-2.5">
      <dt className="text-[11px] font-medium text-[var(--text-secondary)]">
        {label}
      </dt>
      <dd
        className={cn(
          "mt-1 text-[20px] font-semibold tabular-nums leading-none",
          tone === "danger" ? "text-[var(--danger-fg)]" : "text-foreground"
        )}
      >
        {value ?? "—"}
      </dd>
    </div>
  );
}

function NewAnketasBlock({
  view,
  query,
}: {
  view: AdminHomeView;
  query: {
    intake?: string;
    status?: string;
    curatorId?: string;
    studyLevel?: string;
  };
}) {
  return (
    <section className="space-y-3">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-[18px] font-semibold text-foreground">
          Новые анкеты
        </h2>
        <span className="rounded-[var(--radius-badge)] bg-muted px-2 py-0.5 text-[12px] font-semibold tabular-nums text-[var(--text-secondary)]">
          {view.newAnketas.length}
        </span>
      </div>

      <details className="rounded-[var(--radius-card)] border border-border bg-card px-4 py-2">
        <summary className="cursor-pointer text-[12px] font-medium text-[var(--text-secondary)]">
          Фильтры
        </summary>
        <form method="get" action="/admin" className="mt-3 grid gap-3 sm:grid-cols-2">
          <label className="space-y-1 text-[12px]">
            <span className="text-[var(--text-secondary)]">Набор</span>
            <select
              name="intake"
              defaultValue={query.intake ?? ""}
              className="h-9 w-full rounded-[var(--radius-control)] border border-input bg-card px-2 text-[13px]"
            >
              <option value="">Все наборы</option>
              {view.filters.intakes.map((item) => (
                <option key={item.intake} value={item.intake}>
                  {item.label}
                  {item.isActive ? " · текущий" : ""}
                </option>
              ))}
            </select>
          </label>
          <label className="space-y-1 text-[12px]">
            <span className="text-[var(--text-secondary)]">Статус решения</span>
            <select
              name="status"
              defaultValue={query.status ?? ""}
              className="h-9 w-full rounded-[var(--radius-control)] border border-input bg-card px-2 text-[13px]"
            >
              <option value="">Все открытые</option>
              <option value="PENDING">Новая анкета</option>
              <option value="UNDER_REVIEW">На рассмотрении</option>
              <option value="REJECTED">Не принят</option>
            </select>
          </label>
          <label className="space-y-1 text-[12px]">
            <span className="text-[var(--text-secondary)]">Куратор</span>
            <select
              name="curatorId"
              defaultValue={query.curatorId ?? ""}
              className="h-9 w-full rounded-[var(--radius-control)] border border-input bg-card px-2 text-[13px]"
            >
              <option value="">Все</option>
              {view.filters.curators.map((curator) => (
                <option key={curator.id} value={curator.id}>
                  {curator.name}
                </option>
              ))}
            </select>
          </label>
          <label className="space-y-1 text-[12px]">
            <span className="text-[var(--text-secondary)]">Уровень обучения</span>
            <select
              name="studyLevel"
              defaultValue={query.studyLevel ?? ""}
              className="h-9 w-full rounded-[var(--radius-control)] border border-input bg-card px-2 text-[13px]"
            >
              <option value="">Все уровни</option>
              {view.filters.studyLevels.map((level) => (
                <option key={level.id} value={level.id}>
                  {level.label}
                </option>
              ))}
            </select>
          </label>
          <div className="sm:col-span-2">
            <Button type="submit" variant="outline" size="sm">
              Применить
            </Button>
          </div>
        </form>
      </details>

      {view.newAnketasEmpty ? (
        <EmptyState
          title="Новых анкет нет"
          description="Нет заполненных анкет, ожидающих решения."
        />
      ) : (
        <ul className="divide-y divide-[var(--divider)] overflow-hidden rounded-[var(--radius-card)] border border-border bg-card">
          {view.newAnketas.map((row) => (
            <li
              key={row.studentId}
              className={cn(
                "flex flex-col gap-3 px-4 py-3.5 sm:flex-row sm:items-center",
                row.accompanimentStatus === "UNDER_REVIEW" &&
                  "border-l-[3px] border-l-[var(--warning)] bg-[var(--warning-bg)]/40"
              )}
            >
              <div className="min-w-0 flex-1 space-y-1.5">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-[14px] font-semibold text-foreground">
                    {row.fullName}
                  </p>
                  <Badge
                    variant={
                      (
                        {
                          ok: "success",
                          warning: "warning",
                          danger: "danger",
                          info: "info",
                          purple: "purple",
                          neutral: "muted",
                        } as const
                      )[toneForStatus(row.accompanimentStatus)]
                    }
                  >
                    {row.statusLabel}
                  </Badge>
                </div>
                <div className="flex flex-wrap gap-x-3 gap-y-1 text-[12px] text-[var(--text-secondary)]">
                  <span>{formatDate(row.questionnaireAt)}</span>
                  <span>{row.intake}</span>
                  <span>{row.studyLevel}</span>
                  {row.directions.length ? (
                    <span>{row.directions.join(", ")}</span>
                  ) : null}
                  {row.preferredLanguage ? (
                    <span>{row.preferredLanguage}</span>
                  ) : null}
                  <span>
                    {row.curatorName ?? "Куратор не назначен"}
                  </span>
                </div>
              </div>
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                <Button asChild size="sm" variant="outline" className="w-full sm:w-auto">
                  <Link href={`/admin/students/${row.studentId}/anketa`}>
                    Открыть анкету
                  </Link>
                </Button>
                {view.canAccept ? (
                  <form action={acceptAccompanimentAction}>
                    <input type="hidden" name="studentId" value={row.studentId} />
                    <input type="hidden" name="redirectTo" value="/admin" />
                    <Button
                      type="submit"
                      size="sm"
                      className="w-full sm:w-auto"
                      disabled={!row.canAccept}
                      title={row.acceptBlockedReason ?? undefined}
                    >
                      Принять на сопровождение
                    </Button>
                  </form>
                ) : null}
                {!row.canAccept && row.acceptBlockedReason ? (
                  <p className="text-[12px] text-muted-foreground">
                    {row.acceptBlockedReason}
                  </p>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function TodayActionsBlock({
  queue,
  count,
}: {
  queue: WorkQueueView;
  count: number;
}) {
  return (
    <section className="space-y-3">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-[18px] font-semibold text-foreground">
          Действия на сегодня
        </h2>
        <span className="rounded-[var(--radius-badge)] bg-muted px-2 py-0.5 text-[12px] font-semibold tabular-nums text-[var(--text-secondary)]">
          {count}
        </span>
      </div>

      {queue.empty ? (
        <EmptyState
          title="На сегодня задач нет"
          description="Нет действий по принятым на сопровождение ученикам."
        />
      ) : (
        <div className="space-y-5">
          {queue.groups
            .filter((group) => group.items.length > 0)
            .map((group) => (
              <div key={group.id} className="space-y-2">
                <h3 className="text-[12px] font-semibold uppercase tracking-wide text-[var(--text-secondary)]">
                  {group.label}
                </h3>
                <ul className="divide-y divide-[var(--divider)] overflow-hidden rounded-[var(--radius-card)] border border-border bg-card">
                  {group.items.map((item) => (
                    <li
                      key={item.id}
                      className={cn(
                        "flex flex-col gap-3 px-4 py-3.5 sm:flex-row sm:items-center",
                        item.deadlineOverdue &&
                          "border-l-[3px] border-l-[var(--danger)] bg-[var(--danger-bg)]/50",
                        item.group === "NEEDS_DECISION" &&
                          !item.deadlineOverdue &&
                          "border-l-[3px] border-l-[var(--warning)] bg-[var(--warning-bg)]/35"
                      )}
                    >
                      <div className="min-w-0 flex-1 space-y-1">
                        <p className="text-[14px] leading-snug">
                          <span className="font-semibold text-foreground">
                            {item.studentName}
                          </span>
                          <span className="text-[var(--text-secondary)]">
                            {" · "}
                            {item.stageLabel}
                          </span>
                        </p>
                        <p className="text-[13px] text-foreground">
                          <span className="font-medium">{item.action}</span>
                          <span className="text-[var(--text-secondary)]">
                            {" · "}
                            {item.reason}
                          </span>
                        </p>
                        {item.deadline ? (
                          <p
                            className={cn(
                              "inline-flex items-center gap-1 text-[12px]",
                              item.deadlineOverdue
                                ? "font-medium text-[var(--danger-fg)]"
                                : "text-muted-foreground"
                            )}
                          >
                            <Clock3 className="h-3 w-3" />
                            {item.deadline}
                          </p>
                        ) : null}
                      </div>
                      <Button
                        asChild
                        size="sm"
                        variant={item.deadlineOverdue ? "default" : "outline"}
                        className="w-full shrink-0 sm:w-auto"
                      >
                        <Link href={item.href}>Открыть</Link>
                      </Button>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
        </div>
      )}
    </section>
  );
}
