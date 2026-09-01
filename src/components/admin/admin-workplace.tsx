import Link from "next/link";
import { cn } from "@/lib/utils";
import { formatDate } from "@/lib/utils";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/empty-state";
import { Button } from "@/components/ui/button";
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
    <div className="mx-auto max-w-4xl space-y-10">
      <PageHeader
        title="Рабочая очередь"
        description="Кого принять на сопровождение и кому помочь сегодня"
      />

      <CohortBlock view={view} />
      <NewAnketasBlock view={view} query={query} />
      <TodayActionsBlock queue={view.workQueue} count={view.todayActionCount} />
    </div>
  );
}

function CohortBlock({ view }: { view: AdminHomeView }) {
  const { cohort, allCohorts } = view;

  return (
    <section className="rounded-xl border border-border bg-card px-5 py-5">
      <div className="flex flex-col gap-1 sm:flex-row sm:items-baseline sm:justify-between">
        <h2 className="text-sm font-semibold">Набор на сопровождение</h2>
        {allCohorts.length > 1 ? (
          <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
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

      <p className="mt-4 text-[15px] font-medium">Набор {cohort.label}</p>
      <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-3">
        <div>
          <dt className="text-xs text-muted-foreground">Принято на сопровождение</dt>
          <dd className="mt-0.5 tabular-nums">{cohort.occupied}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">Лимит</dt>
          <dd className="mt-0.5">
            {cohort.limitUnset ? "Лимит набора не задан" : cohort.limit}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">Осталось мест</dt>
          <dd className="mt-0.5 tabular-nums">
            {cohort.limitUnset ? "—" : cohort.remaining}
          </dd>
        </div>
      </dl>
      {cohort.fullReason ? (
        <p className="mt-3 text-sm text-[var(--danger-fg)]">{cohort.fullReason}</p>
      ) : null}
      {view.canEditLimit ? (
        <p className="mt-3 text-xs text-muted-foreground">
          Лимит задаётся в{" "}
          <Link href="/admin/settings" className="underline-offset-2 hover:underline">
            настройках
          </Link>
          .
        </p>
      ) : null}
    </section>
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
        <h2 className="text-sm font-semibold">Новые анкеты</h2>
        <span className="text-xs tabular-nums text-muted-foreground">
          {view.newAnketas.length}
        </span>
      </div>

      <details className="rounded-lg border border-border bg-card px-4 py-2">
        <summary className="cursor-pointer text-xs text-muted-foreground">
          Фильтры
        </summary>
        <form method="get" action="/admin" className="mt-3 grid gap-3 sm:grid-cols-2">
          <label className="space-y-1 text-xs">
            <span className="text-muted-foreground">Набор</span>
            <select
              name="intake"
              defaultValue={query.intake ?? ""}
              className="h-8 w-full rounded-md border border-input bg-card px-2 text-[13px]"
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
          <label className="space-y-1 text-xs">
            <span className="text-muted-foreground">Статус решения</span>
            <select
              name="status"
              defaultValue={query.status ?? ""}
              className="h-8 w-full rounded-md border border-input bg-card px-2 text-[13px]"
            >
              <option value="">Все открытые</option>
              <option value="PENDING">Новая анкета</option>
              <option value="UNDER_REVIEW">На рассмотрении</option>
              <option value="REJECTED">Не принят</option>
            </select>
          </label>
          <label className="space-y-1 text-xs">
            <span className="text-muted-foreground">Куратор</span>
            <select
              name="curatorId"
              defaultValue={query.curatorId ?? ""}
              className="h-8 w-full rounded-md border border-input bg-card px-2 text-[13px]"
            >
              <option value="">Все</option>
              {view.filters.curators.map((curator) => (
                <option key={curator.id} value={curator.id}>
                  {curator.name}
                </option>
              ))}
            </select>
          </label>
          <label className="space-y-1 text-xs">
            <span className="text-muted-foreground">Уровень обучения</span>
            <select
              name="studyLevel"
              defaultValue={query.studyLevel ?? ""}
              className="h-8 w-full rounded-md border border-input bg-card px-2 text-[13px]"
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
        <EmptyState title="Новых анкет нет" description="Нет заполненных анкет, ожидающих решения." />
      ) : (
        <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card">
          {view.newAnketas.map((row) => (
            <li
              key={row.studentId}
              className={cn(
                "flex flex-col gap-3 px-4 py-3.5 sm:flex-row sm:items-center",
                row.accompanimentStatus === "UNDER_REVIEW" &&
                  "border-l-[3px] border-l-[var(--warning)]"
              )}
            >
              <div className="min-w-0 flex-1 space-y-1">
                <p className="text-sm font-semibold">{row.fullName}</p>
                <p className="text-xs leading-relaxed text-muted-foreground">
                  {formatDate(row.questionnaireAt)}
                  {" · "}
                  {row.intake}
                  {" · "}
                  {row.studyLevel}
                  {row.directions.length ? ` · ${row.directions.join(", ")}` : ""}
                  {row.preferredLanguage ? ` · ${row.preferredLanguage}` : ""}
                  {row.curatorName ? ` · ${row.curatorName}` : " · Куратор не назначен"}
                  {" · "}
                  {row.statusLabel}
                </p>
              </div>
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                <Button asChild size="lg" variant="outline" className="w-full sm:w-auto">
                  <Link href={`/admin/students/${row.studentId}/anketa`}>Открыть анкету</Link>
                </Button>
                {view.canAccept ? (
                  <form action={acceptAccompanimentAction}>
                    <input type="hidden" name="studentId" value={row.studentId} />
                    <input type="hidden" name="redirectTo" value="/admin" />
                    <Button
                      type="submit"
                      size="lg"
                      className="w-full sm:w-auto"
                      disabled={!row.canAccept}
                      title={row.acceptBlockedReason ?? undefined}
                    >
                      Принять на сопровождение
                    </Button>
                  </form>
                ) : null}
                {!row.canAccept && row.acceptBlockedReason ? (
                  <p className="text-xs text-muted-foreground">{row.acceptBlockedReason}</p>
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
        <h2 className="text-sm font-semibold">Действия на сегодня</h2>
        <span className="text-xs tabular-nums text-muted-foreground">{count}</span>
      </div>

      {queue.empty ? (
        <EmptyState title="На сегодня задач нет" description="Нет действий по принятым на сопровождение ученикам." />
      ) : (
        <div className="space-y-6">
          {queue.groups
            .filter((group) => group.items.length > 0)
            .map((group) => (
              <div key={group.id} className="space-y-2">
                <h3 className="text-xs font-medium text-muted-foreground">{group.label}</h3>
                <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card">
                  {group.items.map((item) => (
                    <li
                      key={item.id}
                      className={cn(
                        "flex flex-col gap-3 px-4 py-3.5 sm:flex-row sm:items-center",
                        item.deadlineOverdue &&
                          "border-l-[3px] border-l-[var(--danger)] bg-[var(--danger-bg)]/30",
                        item.group === "NEEDS_DECISION" &&
                          !item.deadlineOverdue &&
                          "border-l-[3px] border-l-[var(--warning)]"
                      )}
                    >
                      <div className="min-w-0 flex-1">
                        <p className="text-sm leading-snug">
                          <span className="font-semibold">{item.studentName}</span>
                          <span className="text-muted-foreground">
                            {" · "}
                            {item.stageLabel}
                          </span>
                        </p>
                        <p className="mt-0.5 text-sm">
                          {item.action}
                          <span className="text-muted-foreground"> · {item.reason}</span>
                          {item.deadline ? (
                            <span
                              className={cn(
                                "ml-1",
                                item.deadlineOverdue
                                  ? "font-medium text-[var(--danger-fg)]"
                                  : "text-muted-foreground"
                              )}
                            >
                              · {item.deadline}
                            </span>
                          ) : null}
                        </p>
                      </div>
                      <Button asChild size="lg" className="w-full shrink-0 sm:w-auto">
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
