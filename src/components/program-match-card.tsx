import { cn } from "@/lib/utils";
import { labelOf } from "@/lib/labels";
import type { ProgramMatch } from "@/server/services/program-match";
import { MapPin } from "lucide-react";

function universityInitials(name: string) {
  const words = name.replace(/^University of /i, "").split(/\s+/).filter(Boolean);
  if (words.length >= 2) {
    return (words[0][0] + words[1][0]).toUpperCase();
  }
  return name.slice(0, 2).toUpperCase();
}

export function ProgramMatchCard({
  match,
  action,
  className,
}: {
  match: ProgramMatch;
  action?: React.ReactNode;
  className?: string;
}) {
  const initials = universityInitials(match.universityName);

  return (
    <article
      className={cn(
        "flex flex-col overflow-hidden rounded-2xl border border-[var(--border)] bg-white shadow-sm",
        className
      )}
    >
      <div className="flex items-start gap-3 border-b border-[var(--border)] bg-[var(--brand-soft)] px-4 py-3">
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-[var(--brand)] text-sm font-semibold tracking-wide text-white">
          {initials}
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="text-[15px] font-semibold leading-snug text-[var(--brand)]">
            {match.universityName}
          </h3>
          {match.city ? (
            <p className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground">
              <MapPin className="h-3 w-3 shrink-0 opacity-70" />
              {match.city}
            </p>
          ) : null}
        </div>
        <span className="shrink-0 rounded-md bg-white/80 px-2 py-1 text-xs font-semibold tabular-nums text-[var(--brand)]">
          {match.score}%
        </span>
      </div>

      <div className="flex flex-1 flex-col gap-3 px-4 py-3.5">
        <div>
          <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            Программа
          </p>
          <p className="mt-0.5 text-sm font-medium text-[var(--foreground)]">
            {match.programName}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            {labelOf(match.degreeLevel)}
            {match.language ? ` · ${match.language}` : ""}
            {match.field ? ` · ${match.field}` : ""}
          </p>
        </div>

        {match.reasons.length > 0 ? (
          <ul className="flex flex-wrap gap-1.5">
            {match.reasons.map((r) => (
              <li
                key={r}
                className="rounded-md bg-[var(--brand-soft)] px-2 py-0.5 text-[11px] text-[var(--brand)]"
              >
                {r}
              </li>
            ))}
          </ul>
        ) : null}

        {action ? <div className="mt-auto pt-1">{action}</div> : null}
      </div>
    </article>
  );
}
