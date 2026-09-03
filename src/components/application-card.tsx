import Link from "next/link";
import { cn, formatDate } from "@/lib/utils";
import { StatusBadge } from "@/components/status-badge";
import { RiskBadge } from "@/components/risk-badge";
import { ProgressBar } from "@/components/progress-bar";
import { UniversityMonogram } from "@/components/university-monogram";
import type { ApplicationStatus, RiskLevel } from "@/lib/enums";

export interface ApplicationCardProps {
  id: string;
  programName: string;
  universityName: string;
  status: ApplicationStatus | string;
  riskLevel?: RiskLevel | string | null;
  readinessPct?: number | null;
  deadline?: Date | string | null;
  studentName?: string | null;
  href?: string;
  className?: string;
}

export function ApplicationCard({
  programName,
  universityName,
  status,
  riskLevel,
  readinessPct,
  deadline,
  studentName,
  href,
  className,
}: ApplicationCardProps) {
  const content = (
    <div
      className={cn(
        "surface-card p-4",
        href && "surface-card-hover",
        className
      )}
    >
      <div className="flex items-start gap-3">
        <UniversityMonogram name={universityName} size="sm" />
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="truncate text-[15px] font-semibold tracking-tight text-foreground">
                {programName}
              </p>
              <p className="truncate text-[13px] text-muted-foreground">
                {universityName}
                {studentName ? ` · ${studentName}` : ""}
              </p>
            </div>
            <StatusBadge status={status} kind="application" />
          </div>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        {riskLevel ? <RiskBadge level={riskLevel} /> : null}
        {deadline ? (
          <span className="text-[12px] text-muted-foreground tabular-nums">
            Срок: {formatDate(deadline)}
          </span>
        ) : null}
      </div>

      {typeof readinessPct === "number" ? (
        <div className="mt-3">
          <ProgressBar value={readinessPct} showLabel size="sm" />
        </div>
      ) : null}
    </div>
  );

  if (href) {
    return <Link href={href}>{content}</Link>;
  }

  return content;
}
