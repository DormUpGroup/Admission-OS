import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { cn } from "@/lib/utils";

export interface MetricCardProps {
  label: string;
  value: string | number;
  hint?: string;
  href?: string;
  tone?: "neutral" | "danger" | "warning" | "ok";
  className?: string;
  onClick?: () => void;
}

const toneStyles = {
  neutral: "",
  danger: "border-l-[3px] border-l-[var(--danger)]",
  warning: "border-l-[3px] border-l-[var(--warning)]",
  ok: "border-l-[3px] border-l-[var(--ok)]",
};

const valueTone = {
  neutral: "text-foreground",
  danger: "text-[var(--danger-fg)]",
  warning: "text-[var(--warning-fg)]",
  ok: "text-[var(--ok-fg)]",
};

export function MetricCard({
  label,
  value,
  hint,
  href,
  tone = "neutral",
  className,
  onClick,
}: MetricCardProps) {
  const content = (
    <>
      <div className="flex items-start justify-between gap-2">
        <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
          {label}
        </p>
        {href ? (
          <ArrowUpRight className="h-3.5 w-3.5 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
        ) : null}
      </div>
      <p
        className={cn(
          "mt-2 text-2xl font-semibold tracking-tight tabular-nums",
          valueTone[tone]
        )}
      >
        {value}
      </p>
      {hint ? (
        <p className="mt-1 text-[11px] text-muted-foreground">{hint}</p>
      ) : null}
    </>
  );

  const classes = cn(
    "group block rounded-lg border border-border bg-card p-3.5 shadow-sm transition-colors",
    toneStyles[tone],
    (href || onClick) && "hover:border-neutral-300 hover:bg-neutral-50/80 cursor-pointer",
    className
  );

  if (href) {
    return (
      <Link href={href} className={classes}>
        {content}
      </Link>
    );
  }

  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        className={cn(classes, "w-full text-left")}
      >
        {content}
      </button>
    );
  }

  return <div className={classes}>{content}</div>;
}
