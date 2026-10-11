import * as React from "react";
import Link from "next/link";
import { cn } from "@/lib/utils";

export type EntityMetaItem = {
  label?: string;
  value: React.ReactNode;
};

export interface EntityHeaderProps {
  title: string;
  description?: string;
  /** Avatar / monogram on the left */
  leading?: React.ReactNode;
  /** Status badges and presence chips next to the title */
  badges?: React.ReactNode;
  /** Quiet secondary facts under the title */
  meta?: EntityMetaItem[] | React.ReactNode;
  actions?: React.ReactNode;
  backHref?: string;
  backLabel?: string;
  className?: string;
  children?: React.ReactNode;
}

export function EntityHeader({
  title,
  description,
  leading,
  badges,
  meta,
  actions,
  backHref,
  backLabel = "Назад",
  className,
  children,
}: EntityHeaderProps) {
  return (
    <div className={cn("flex flex-col gap-3", className)}>
      {backHref ? (
        <Link
          href={backHref}
          className="w-fit text-[13px] text-[var(--text-secondary)] transition-colors hover:text-foreground"
        >
          ← {backLabel}
        </Link>
      ) : null}

      <div className="flex items-start gap-3 sm:gap-4">
        {leading ? <div className="shrink-0">{leading}</div> : null}

        <div className="min-w-0 flex-1 space-y-2">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0 space-y-1.5">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-balance text-[24px] font-semibold tracking-tight text-foreground sm:text-[26px]">
                  {title}
                </h1>
                {badges}
              </div>
              {description ? (
                <p className="max-w-2xl text-[13px] leading-relaxed text-[var(--text-secondary)]">
                  {description}
                </p>
              ) : null}
              {meta ? <EntityMeta meta={meta} /> : null}
            </div>
            {actions ? (
              <div className="flex shrink-0 flex-wrap items-center gap-2">
                {actions}
              </div>
            ) : null}
          </div>
          {children}
        </div>
      </div>
    </div>
  );
}

function EntityMeta({ meta }: { meta: EntityMetaItem[] | React.ReactNode }) {
  if (!Array.isArray(meta)) {
    return (
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[12px] text-[var(--text-secondary)]">
        {meta}
      </div>
    );
  }

  if (meta.length === 0) return null;

  return (
    <dl className="flex flex-wrap gap-x-4 gap-y-1.5 text-[12px] text-[var(--text-secondary)]">
      {meta.map((item, index) => (
        <div key={item.label ?? index}>
          {item.label ? (
            <>
              <dt className="inline text-muted-foreground">{item.label}: </dt>
              <dd className="inline">{item.value}</dd>
            </>
          ) : (
            <dd>{item.value}</dd>
          )}
        </div>
      ))}
    </dl>
  );
}
