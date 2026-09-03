import Link from "next/link";
import { cn, formatDate } from "@/lib/utils";
import { StatusBadge } from "@/components/status-badge";
import { ProgressBar } from "@/components/progress-bar";
import { CalendarDays, ChevronRight, MapPin } from "lucide-react";

function universityInitials(name: string) {
  const words = name.replace(/^University of /i, "").split(/\s+/).filter(Boolean);
  if (words.length >= 2) {
    return (words[0][0] + words[1][0]).toUpperCase();
  }
  return name.slice(0, 2).toUpperCase();
}

export interface PortalUniversityCardProps {
  universityName: string;
  programName: string;
  city?: string | null;
  intake?: string | null;
  status: string;
  readinessPercent: number;
  deadline?: Date | string | null;
  href?: string;
  className?: string;
}

export function PortalUniversityCard({
  universityName,
  programName,
  city,
  intake,
  status,
  readinessPercent,
  deadline,
  href,
  className,
}: PortalUniversityCardProps) {
  const initials = universityInitials(universityName);

  const card = (
    <article
      className={cn(
        "overflow-hidden rounded-2xl border border-[var(--border)] bg-white shadow-sm transition-all",
        href && "group hover:border-[var(--brand-muted)] hover:shadow-md",
        className
      )}
    >
      <div className="flex items-start gap-3 border-b border-[var(--border)] bg-[var(--brand-soft)] px-4 py-3">
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-[var(--brand)] text-sm font-semibold tracking-wide text-white shadow-sm">
          {initials}
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="text-[15px] font-semibold leading-snug text-[var(--brand)]">
            {universityName}
          </h3>
          {city ? (
            <p className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground">
              <MapPin className="h-3 w-3 shrink-0 opacity-70" />
              {city}
            </p>
          ) : null}
        </div>
        <StatusBadge status={status} kind="application" />
      </div>

      <div className="space-y-3 px-4 py-3.5">
        <div>
          <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            Программа
          </p>
          <p className="mt-0.5 text-sm font-medium text-[var(--foreground)]">
            {programName}
          </p>
          {intake ? (
            <p className="mt-1 text-xs text-muted-foreground">Набор {intake}</p>
          ) : null}
        </div>

        <ProgressBar
          value={readinessPercent}
          showLabel
          size="sm"
          barClassName="bg-[var(--brand)]"
        />

        {deadline ? (
          <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <CalendarDays className="h-3.5 w-3.5 shrink-0 text-[var(--brand)]" />
            <span>
              Дедлайн заявки:{" "}
              <span className="font-medium text-[var(--foreground)]">
                {formatDate(deadline)}
              </span>
            </span>
          </p>
        ) : null}

        {href ? (
          <p className="flex items-center gap-1 text-xs font-medium text-[var(--brand)]">
            Подробнее о поступлении
            <ChevronRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" />
          </p>
        ) : null}
      </div>
    </article>
  );

  if (href) {
    return (
      <Link
        href={href}
        className="block rounded-2xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand)] focus-visible:ring-offset-2"
      >
        {card}
      </Link>
    );
  }

  return card;
}
