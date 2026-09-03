import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { formatDate } from "@/lib/utils";
import {
  acceptAccompanimentAction,
  rejectAccompanimentAction,
  requestAccompanimentClarificationAction,
} from "@/server/actions";
import type { AnketaDecisionView } from "@/server/services/accompaniment";

function FieldList({
  items,
}: {
  items: Array<{ label: string; value: string }>;
}) {
  if (items.length === 0) {
    return <p className="text-sm text-muted-foreground">Не указано</p>;
  }
  return (
    <dl className="grid gap-3 sm:grid-cols-2">
      {items.map((item) => (
        <div key={item.label}>
          <dt className="text-xs text-muted-foreground">{item.label}</dt>
          <dd className="mt-0.5 text-sm">{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}

export function AnketaDecisionScreen({
  view,
  error,
}: {
  view: AnketaDecisionView;
  error?: string;
}) {
  const primaryAccept = view.primaryAction === "accept";
  const primaryClarify = view.primaryAction === "clarify";

  return (
    <div className="mx-auto max-w-3xl space-y-8">
      <PageHeader
        title={view.fullName}
        description={`${view.email} · набор ${view.intake} · ${view.statusLabel}`}
      />

      {error ? (
        <p className="rounded-2xl border border-[var(--danger)] bg-[var(--danger-bg)]/40 px-4 py-2 text-sm text-[var(--danger-fg)]">
          {error}
        </p>
      ) : null}

      <div className="flex flex-col gap-2">
        {view.canAccept || view.acceptBlockedReason ? (
          <form action={acceptAccompanimentAction}>
            <input type="hidden" name="studentId" value={view.studentId} />
            <Button
              type="submit"
              size="lg"
              className="w-full sm:w-auto"
              variant={primaryAccept ? "default" : "outline"}
              disabled={!view.canAccept}
              title={view.acceptBlockedReason ?? undefined}
            >
              Принять на сопровождение
            </Button>
          </form>
        ) : null}
        {!view.canAccept && view.acceptBlockedReason ? (
          <p className="text-sm text-muted-foreground">{view.acceptBlockedReason}</p>
        ) : null}

        {view.canClarify ? (
          <form action={requestAccompanimentClarificationAction} className="space-y-2">
            <input type="hidden" name="studentId" value={view.studentId} />
            <textarea
              name="note"
              rows={2}
              placeholder="Что уточнить у ученика"
              className="w-full rounded-xl border border-input bg-card px-3 py-2 text-sm"
            />
            <Button
              type="submit"
              size="lg"
              className="w-full sm:w-auto"
              variant={primaryClarify ? "default" : "outline"}
            >
              Запросить уточнение
            </Button>
          </form>
        ) : null}

        {view.insufficientReason ? (
          <p className="text-sm text-muted-foreground">{view.insufficientReason}</p>
        ) : null}

        {view.canReject ? (
          <form action={rejectAccompanimentAction}>
            <input type="hidden" name="studentId" value={view.studentId} />
            <Button type="submit" size="lg" variant="ghost" className="w-full sm:w-auto">
              Отказать
            </Button>
          </form>
        ) : null}
      </div>

      <section className="space-y-2">
        <h2 className="text-sm font-semibold">Личные данные</h2>
        <FieldList items={view.personal} />
      </section>

      <section className="space-y-2">
        <h2 className="text-sm font-semibold">План обучения</h2>
        <FieldList items={view.plan} />
      </section>

      <section className="space-y-2">
        <h2 className="text-sm font-semibold">Направления</h2>
        <p className="text-sm">
          {view.directions.length ? view.directions.join(", ") : "Не указано"}
        </p>
      </section>

      <section className="space-y-2">
        <h2 className="text-sm font-semibold">Язык</h2>
        <p className="text-sm">{view.language || "Не указано"}</p>
      </section>

      <section className="space-y-2">
        <h2 className="text-sm font-semibold">Города</h2>
        <p className="text-sm">
          {view.cities.length ? view.cities.join(", ") : "Не указано"}
        </p>
        {view.avoidCities.length ? (
          <p className="text-sm text-muted-foreground">
            Не рассматривает: {view.avoidCities.join(", ")}
          </p>
        ) : null}
      </section>

      {view.finance.length ? (
        <section className="space-y-2">
          <h2 className="text-sm font-semibold">Бюджет и финансы</h2>
          <FieldList items={view.finance} />
        </section>
      ) : null}

      {view.comments.length ? (
        <section className="space-y-2">
          <h2 className="text-sm font-semibold">Комментарии студента</h2>
          {view.comments.map((comment) => (
            <p key={comment} className="text-sm leading-relaxed">
              {comment}
            </p>
          ))}
        </section>
      ) : null}

      <section className="space-y-2">
        <h2 className="text-sm font-semibold">Сопровождение</h2>
        <dl className="grid gap-3 sm:grid-cols-2 text-sm">
          <div>
            <dt className="text-xs text-muted-foreground">Куратор</dt>
            <dd className="mt-0.5">{view.curatorName ?? "Не назначен"}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Статус</dt>
            <dd className="mt-0.5">{view.statusLabel}</dd>
          </div>
          {view.acceptedAt ? (
            <div>
              <dt className="text-xs text-muted-foreground">Принят</dt>
              <dd className="mt-0.5">
                {formatDate(view.acceptedAt)}
                {view.acceptedByName ? ` · ${view.acceptedByName}` : ""}
              </dd>
            </div>
          ) : null}
        </dl>
      </section>

      <p className="text-sm">
        <Link
          href={`/admin/students/${view.studentId}`}
          className="text-[var(--brand)] underline-offset-2 hover:underline"
        >
          Открыть карточку ученика
        </Link>
      </p>
    </div>
  );
}
