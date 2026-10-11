import { cn, formatDate } from "@/lib/utils";

export interface ActivityItem {
  id: string;
  type?: string;
  title: string;
  description?: string | null;
  actorName?: string | null;
  createdAt: Date | string;
  href?: string | null;
}

export interface ActivityTimelineProps {
  items: ActivityItem[];
  className?: string;
  emptyMessage?: string;
  highlightId?: string;
}

export function ActivityTimeline({
  items,
  className,
  emptyMessage = "Пока нет событий",
  highlightId,
}: ActivityTimelineProps) {
  if (items.length === 0) {
    return (
      <p className={cn("text-xs text-muted-foreground py-4", className)}>
        {emptyMessage}
      </p>
    );
  }

  return (
    <ol className={cn("relative space-y-0", className)}>
      {items.map((item, index) => (
        <li
          key={item.id}
          id={`activity-${item.id}`}
          className={cn(
            "relative flex scroll-mt-24 gap-3 rounded-xl pb-4 last:pb-0",
            highlightId === item.id && "bg-muted px-2 py-2",
          )}
        >
          {index < items.length - 1 ? (
            <span className="absolute left-[5px] top-3 bottom-0 w-px bg-border" />
          ) : null}
          <span className="relative mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full border-2 border-border bg-card" />
          <div className="min-w-0 flex-1">
            <div className="flex items-baseline justify-between gap-2">
              <p className="truncate text-[13px] font-medium text-foreground">
                {item.title}
              </p>
              <time className="shrink-0 text-[11px] tabular-nums text-muted-foreground">
                {formatDate(item.createdAt)}
              </time>
            </div>
            {item.description ? (
              <p className="mt-0.5 text-xs text-muted-foreground line-clamp-2">
                {item.description}
              </p>
            ) : null}
            {item.href ? (
              <a
                href={item.href}
                className="mt-1 inline-block text-xs font-medium text-[var(--brand)] underline-offset-2 hover:underline"
              >
                Открыть программы
              </a>
            ) : null}
            {item.actorName ? (
              <p className="mt-1 text-[11px] text-muted-foreground">
                {item.actorName}
              </p>
            ) : null}
          </div>
        </li>
      ))}
    </ol>
  );
}
