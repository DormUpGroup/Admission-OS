import { CheckCircle2, Circle, AlertCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import { StatusBadge } from "@/components/status-badge";
import type { RequirementStatus, RequirementType } from "@/lib/enums";

export interface RequirementListItem {
  id: string;
  title: string;
  status: RequirementStatus | string;
  type?: RequirementType | string | null;
  required?: boolean;
}

export interface RequirementListProps {
  requirements: RequirementListItem[];
  className?: string;
  emptyMessage?: string;
}

function StatusIcon({ status }: { status: string }) {
  if (status === "COMPLETED" || status === "APPROVED") {
    return <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />;
  }
  if (status === "BLOCKED" || status === "NEEDS_CHANGES") {
    return <AlertCircle className="h-3.5 w-3.5 text-orange-600" />;
  }
  return <Circle className="h-3.5 w-3.5 text-neutral-300" />;
}

export function RequirementList({
  requirements,
  className,
  emptyMessage = "Нет требований",
}: RequirementListProps) {
  if (requirements.length === 0) {
    return (
      <p className={cn("text-xs text-muted-foreground py-4", className)}>
        {emptyMessage}
      </p>
    );
  }

  return (
    <ul
      className={cn(
        "divide-y divide-border surface-card",
        className
      )}
    >
      {requirements.map((req) => (
        <li
          key={req.id}
          className="flex items-center gap-3 px-3 py-2.5"
        >
          <StatusIcon status={String(req.status)} />
          <div className="min-w-0 flex-1">
            <p className="truncate text-[13px] font-medium text-foreground">
              {req.title}
              {req.required === false ? (
                <span className="ml-1.5 text-[10px] font-normal text-muted-foreground">
                  optional
                </span>
              ) : null}
            </p>
            {req.type ? (
              <p className="text-[11px] capitalize text-muted-foreground">
                {String(req.type).toLowerCase()}
              </p>
            ) : null}
          </div>
          <StatusBadge status={req.status} kind="requirement" />
        </li>
      ))}
    </ul>
  );
}
