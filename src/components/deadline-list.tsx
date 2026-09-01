import Link from "next/link";
import { CalendarClock } from "lucide-react";
import { cn, daysUntil, formatDate } from "@/lib/utils";
import type { DeadlineType } from "@/lib/enums";

export interface DeadlineListItem {
  id: string;
  title: string;
  dueDate: Date | string;
  type?: DeadlineType | string | null;
  studentName?: string | null;
  href?: string;
}

export interface DeadlineListProps {
  deadlines: DeadlineListItem[];
  className?: string;
  emptyMessage?: string;
}

function urgencyClass(due: Date | string) {
  const d = typeof due === "string" ? new Date(due) : due;
  const days = daysUntil(d);
  if (days < 0) return "text-red-600";
  if (days <= 3) return "text-orange-600";
  if (days <= 7) return "text-amber-600";
  return "text-muted-foreground";
}

export function DeadlineList({
  deadlines,
  className,
  emptyMessage = "Нет ближайших дедлайнов",
}: DeadlineListProps) {
  if (deadlines.length === 0) {
    return (
      <p className={cn("text-xs text-muted-foreground py-4", className)}>
        {emptyMessage}
      </p>
    );
  }

  return (
    <ul className={cn("divide-y divide-border rounded-lg border border-border bg-card", className)}>
      {deadlines.map((item) => {
        const due =
          typeof item.dueDate === "string"
            ? new Date(item.dueDate)
            : item.dueDate;
        const days = daysUntil(due);
        const row = (
          <div className="flex items-center gap-3 px-3 py-2.5 hover:bg-muted/60 transition-colors">
            <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
              <CalendarClock className="h-3.5 w-3.5" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-[13px] font-medium text-foreground">
                {item.title}
              </p>
              <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[11px] text-muted-foreground">
                {item.studentName ? <span>{item.studentName}</span> : null}
                {item.type ? (
                  <span className="uppercase tracking-wide">
                    {String(item.type).toLowerCase()}
                  </span>
                ) : null}
              </div>
            </div>
            <div className="shrink-0 text-right">
              <p className={cn("text-[12px] font-medium tabular-nums", urgencyClass(due))}>
                {formatDate(due)}
              </p>
              <p className="text-[10px] text-muted-foreground tabular-nums">
                {days < 0
                  ? `просрочено на ${Math.abs(days)} дн.`
                  : days === 0
                    ? "Сегодня"
                    : `через ${days} дн.`}
              </p>
            </div>
          </div>
        );

        return (
          <li key={item.id}>
            {item.href ? <Link href={item.href}>{row}</Link> : row}
          </li>
        );
      })}
    </ul>
  );
}
