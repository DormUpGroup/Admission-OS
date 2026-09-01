import Link from "next/link";
import { ArrowRight, Zap } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

export interface NextActionCardProps {
  title: string;
  description?: string;
  meta?: string;
  href?: string;
  actionLabel?: string;
  className?: string;
}

export function NextActionCard({
  title,
  description,
  meta,
  href,
  actionLabel = "Открыть",
  className,
}: NextActionCardProps) {
  return (
    <div
      className={cn(
        "flex items-start gap-3 rounded-lg border border-border bg-card p-3.5 shadow-sm",
        className
      )}
    >
      <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-[var(--brand)] text-white">
        <Zap className="h-3.5 w-3.5" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              Следующее действие
            </p>
            <p className="mt-0.5 truncate text-sm font-semibold text-foreground">
              {title}
            </p>
            {description ? (
              <p className="mt-0.5 text-xs text-muted-foreground line-clamp-2">
                {description}
              </p>
            ) : null}
            {meta ? (
              <p className="mt-1.5 text-[11px] text-muted-foreground">{meta}</p>
            ) : null}
          </div>
          {href ? (
            <Button asChild size="sm" variant="outline" className="shrink-0">
              <Link href={href}>
                {actionLabel}
                <ArrowRight className="h-3 w-3" />
              </Link>
            </Button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
