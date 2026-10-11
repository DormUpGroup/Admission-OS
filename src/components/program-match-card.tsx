import type { ReactNode } from "react";
import { cn, formatDate } from "@/lib/utils";
import { labelOf } from "@/lib/labels";
import type { ProgramMatch } from "@/server/services/program-match";
import { UniversityMonogram } from "@/components/university-monogram";

export function ProgramMatchCard({
  match,
  action,
  className,
}: {
  match: ProgramMatch;
  action?: ReactNode;
  className?: string;
}) {
  const tuition =
    match.tuitionFixed != null
      ? `€${match.tuitionFixed}`
      : match.tuitionMin != null && match.tuitionMax != null
        ? `€${match.tuitionMin}–${match.tuitionMax}`
        : match.tuitionMin != null
          ? `от €${match.tuitionMin}`
          : match.tuitionMax != null
            ? `до €${match.tuitionMax}`
            : "Стоимость уточняется";

  const meta = [
    labelOf(match.degreeLevel),
    match.language,
    match.field,
  ].filter(Boolean);

  return (
    <article
      className={cn(
        "flex flex-col overflow-hidden rounded-[var(--radius-card)] border border-border bg-card",
        className,
      )}
    >
      <div className="flex items-start gap-3 px-4 pb-3 pt-3.5">
        <UniversityMonogram name={match.universityName} size="sm" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-[13px] text-[var(--text-secondary)]">
            {match.universityName}
          </p>
          <h3 className="mt-0.5 text-[16px] font-semibold leading-snug tracking-tight text-foreground">
            {match.programName}
          </h3>
          {match.city || meta.length > 0 ? (
            <p className="mt-1 text-[12px] text-muted-foreground">
              {[match.city, ...meta].filter(Boolean).join(" · ")}
            </p>
          ) : null}
        </div>
        <div className="shrink-0 text-right">
          <p className="text-[11px] text-[var(--text-secondary)]">
            Соответствие
          </p>
          <p className="text-[20px] font-semibold leading-none tabular-nums text-[var(--brand-fg)]">
            {match.score}
            <span className="text-[12px] font-medium text-muted-foreground">
              %
            </span>
          </p>
        </div>
      </div>

      <dl className="divide-y divide-[var(--divider)] border-t border-[var(--divider)] px-4 text-[13px]">
        <div className="flex justify-between gap-3 py-2">
          <dt className="text-[var(--text-secondary)]">Дедлайн</dt>
          <dd className="text-right font-medium tabular-nums">
            {match.deadline ? formatDate(match.deadline) : "Уточняется"}
          </dd>
        </div>
        <div className="flex justify-between gap-3 py-2">
          <dt className="text-[var(--text-secondary)]">Стоимость</dt>
          <dd className="text-right font-medium">{tuition}</dd>
        </div>
        <div className="flex justify-between gap-3 py-2">
          <dt className="text-[var(--text-secondary)]">Квота</dt>
          <dd className="text-right font-medium">
            {match.quotaSeats != null
              ? `${match.quotaSeats} мест`
              : "Уточняется"}
          </dd>
        </div>
      </dl>

      {action ? (
        <div className="border-t border-[var(--divider)] bg-muted/25 px-4 py-2.5">
          {action}
        </div>
      ) : null}
    </article>
  );
}
