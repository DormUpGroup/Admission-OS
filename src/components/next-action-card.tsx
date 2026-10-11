import Link from "next/link";
import { ArrowRight, AlertCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

export interface NextActionCardProps {
  title: string;
  description?: string;
  meta?: string;
  href?: string;
  actionLabel?: string;
  className?: string;
  /** Soft amber attention styling when something needs action */
  attention?: boolean;
}

export function NextActionCard({
  title,
  description,
  meta,
  href,
  actionLabel = "Открыть",
  className,
  attention = true,
}: NextActionCardProps) {
  return (
    <div
      className={cn(
        "flex items-start gap-3 rounded-[var(--radius-card)] border px-4 py-3.5",
        attention
          ? "border-[color-mix(in_srgb,var(--warning)_28%,var(--border))] bg-[var(--warning-bg)]"
          : "border-border bg-card",
        className
      )}
    >
      <div
        className={cn(
          "mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-[var(--radius-control)]",
          attention
            ? "bg-[color-mix(in_srgb,var(--warning)_16%,white)] text-[var(--warning-fg)]"
            : "bg-[var(--brand-soft)] text-[var(--brand-fg)]"
        )}
      >
        <AlertCircle className="h-4 w-4" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p
              className={cn(
                "text-[11px] font-semibold uppercase tracking-wide",
                attention ? "text-[var(--warning-fg)]" : "text-muted-foreground"
              )}
            >
              Следующее действие
            </p>
            <p className="mt-0.5 text-[14px] font-semibold text-foreground">
              {title}
            </p>
            {description ? (
              <p className="mt-0.5 text-[13px] text-[var(--text-secondary)] line-clamp-2">
                {description}
              </p>
            ) : null}
            {meta ? (
              <p className="mt-1.5 text-[12px] text-muted-foreground">{meta}</p>
            ) : null}
          </div>
          {href ? (
            <Button asChild size="sm" className="shrink-0">
              <Link href={href}>
                {actionLabel}
                <ArrowRight className="h-3.5 w-3.5" />
              </Link>
            </Button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
