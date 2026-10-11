"use client";

import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export function BulkActionBar({
  count,
  onClear,
  children,
  className,
}: {
  count: number;
  onClear: () => void;
  children: ReactNode;
  className?: string;
}) {
  if (count <= 0) return null;

  return (
    <div
      className={cn(
        "sticky bottom-3 z-30 flex justify-center px-2",
        className,
      )}
    >
      <div
        className="flex w-full max-w-2xl flex-wrap items-center justify-between gap-3 rounded-[var(--radius-card)] border border-border bg-card px-4 py-3 shadow-[var(--shadow-card-hover)]"
        role="toolbar"
        aria-label="Действия с выбранными строками"
      >
        <div className="flex min-w-0 items-center gap-3">
          <p className="text-[13px] font-medium text-foreground">
            Выбрано:{" "}
            <span className="tabular-nums text-[var(--brand-fg)]">{count}</span>
          </p>
          <Button type="button" size="sm" variant="ghost" onClick={onClear}>
            Снять выделение
          </Button>
        </div>
        <div className="flex flex-wrap items-center gap-2">{children}</div>
      </div>
    </div>
  );
}
