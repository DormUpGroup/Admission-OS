import Link from "next/link";
import { cn, formatDate } from "@/lib/utils";
import { StatusBadge } from "@/components/status-badge";
import { ProgressBar } from "@/components/progress-bar";
import { UniversityMonogram } from "@/components/university-monogram";
import { CalendarDays, ChevronRight } from "lucide-react";

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
  const card = (
    <article
      className={cn(
        "surface-card overflow-hidden",
        href && "surface-card-hover group",
        className
      )}
    >
      <div className="flex items-start gap-3.5 px-5 pt-5">
        <UniversityMonogram name={universityName} />
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <h3 className="text-[17px] font-semibold leading-snug tracking-tight text-foreground">
              {universityName}
            </h3>
            <StatusBadge status={status} kind="application" />
          </div>
          {city ? (
            <p className="mt-0.5 text-[13px] text-muted-foreground">{city}</p>
          ) : null}
        </div>
      </div>

      <div className="space-y-3.5 px-5 py-4">
        <div>
          <p className="text-[13px] leading-snug text-foreground">{programName}</p>
          {intake ? (
            <p className="mt-1 text-[13px] text-muted-foreground">Набор {intake}</p>
          ) : null}
        </div>

        <ProgressBar value={readinessPercent} showLabel size="sm" />

        {deadline ? (
          <p className="flex items-center gap-1.5 text-[13px] text-muted-foreground">
            <CalendarDays className="h-3.5 w-3.5 shrink-0 opacity-70" />
            <span>
              Дедлайн заявки:{" "}
              <span className="font-medium text-foreground">{formatDate(deadline)}</span>
            </span>
          </p>
        ) : null}

        {href ? (
          <p className="flex items-center gap-1 text-[13px] font-medium text-muted-foreground transition-colors group-hover:text-[var(--brand)]">
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
        className="block rounded-[22px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand)] focus-visible:ring-offset-2"
      >
        {card}
      </Link>
    );
  }

  return card;
}
