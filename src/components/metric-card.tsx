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

const valueTone = {
  neutral: "text-foreground",
  danger: "text-[var(--danger-fg)]",
  warning: "text-[var(--warning-fg)]",
  ok: "text-[var(--ok-fg)]",
};

const surfaceTone = {
  neutral: "",
  danger: "border-[color-mix(in_srgb,var(--danger)_22%,var(--border))]",
  warning: "border-[color-mix(in_srgb,var(--warning)_22%,var(--border))]",
  ok: "border-[color-mix(in_srgb,var(--ok)_22%,var(--border))]",
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
        <p className="text-[12px] font-medium text-[var(--text-secondary)]">
          {label}
        </p>
        {href ? (
          <ArrowUpRight className="h-3.5 w-3.5 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
        ) : null}
      </div>
      <p
        className={cn(
          "mt-1.5 text-[26px] font-semibold tracking-tight tabular-nums leading-none",
          valueTone[tone]
        )}
      >
        {value}
      </p>
      {hint ? (
        <p className="mt-1.5 text-[12px] text-muted-foreground">{hint}</p>
      ) : null}
    </>
  );

  const classes = cn(
    "group block rounded-[var(--radius-card)] border border-border bg-card p-4 transition-[box-shadow,border-color]",
    surfaceTone[tone],
    (href || onClick) && "surface-card-hover cursor-pointer",
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
