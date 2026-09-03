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
  action?: React.ReactNode;
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
        "flex flex-col overflow-hidden surface-card",
        className
      )}
    >
      <div className="flex items-start gap-3.5 px-5 pt-5">
        <UniversityMonogram name={match.universityName} />
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <h3 className="text-[17px] font-semibold leading-snug tracking-tight text-foreground">
              {match.universityName}
            </h3>
            <span className="surface-chip shrink-0 rounded-full px-2.5 py-1 text-[12px] font-semibold tabular-nums text-[var(--brand)]">
              {match.score}%
            </span>
          </div>
          {match.city ? (
            <p className="mt-0.5 text-[13px] text-muted-foreground">{match.city}</p>
          ) : null}
        </div>
      </div>

      <div className="flex flex-1 flex-col gap-3.5 px-5 py-4">
        <div>
          <p className="text-[13px] leading-snug text-foreground">{match.programName}</p>
          {meta.length > 0 ? (
            <p className="mt-1 text-[13px] text-muted-foreground">{meta.join(" · ")}</p>
          ) : null}
        </div>

        <dl className="divide-y divide-border text-[13px]">
          <div className="flex justify-between gap-3 py-2 first:pt-0">
            <dt className="text-muted-foreground">Дедлайн</dt>
            <dd className="text-right font-medium">
              {match.deadline ? formatDate(match.deadline) : "Дедлайн уточняется"}
            </dd>
          </div>
          <div className="flex justify-between gap-3 py-2">
            <dt className="text-muted-foreground">Стоимость</dt>
            <dd className="text-right font-medium">{tuition}</dd>
          </div>
          <div className="flex justify-between gap-3 py-2 last:pb-0">
            <dt className="text-muted-foreground">Квота</dt>
            <dd className="text-right font-medium">
              {match.quotaSeats != null
                ? `${match.quotaSeats} мест`
                : "Квота уточняется"}
            </dd>
          </div>
        </dl>

        {action ? <div className="mt-auto pt-1">{action}</div> : null}
      </div>
    </article>
  );
}
