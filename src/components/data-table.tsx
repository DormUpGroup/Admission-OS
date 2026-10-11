import * as React from "react";
import { cn } from "@/lib/utils";

export interface DataTableProps extends React.HTMLAttributes<HTMLDivElement> {
  children: React.ReactNode;
}

export function DataTable({ className, children, ...props }: DataTableProps) {
  return (
    <div
      className={cn(
        "w-full overflow-x-auto overscroll-x-contain rounded-[var(--radius-card)] border border-border bg-card",
        className
      )}
      {...props}
    >
      <table className="w-full min-w-[640px] caption-bottom text-[13px]">
        {children}
      </table>
    </div>
  );
}

export function DataTableHeader({
  className,
  ...props
}: React.HTMLAttributes<HTMLTableSectionElement>) {
  return (
    <thead
      className={cn(
        "border-b border-[var(--divider)] bg-muted/70 [&_tr]:border-b-0",
        className
      )}
      {...props}
    />
  );
}

export function DataTableBody({
  className,
  ...props
}: React.HTMLAttributes<HTMLTableSectionElement>) {
  return (
    <tbody
      className={cn("[&_tr:last-child]:border-0", className)}
      {...props}
    />
  );
}

export function DataTableRow({
  className,
  ...props
}: React.HTMLAttributes<HTMLTableRowElement>) {
  return (
    <tr
      className={cn(
        "border-b border-[var(--divider)] transition-colors hover:bg-[var(--brand-soft)]/40 data-[state=selected]:bg-[var(--brand-soft)]",
        className
      )}
      {...props}
    />
  );
}

export function DataTableHead({
  className,
  ...props
}: React.ThHTMLAttributes<HTMLTableCellElement>) {
  return (
    <th
      className={cn(
        "h-10 px-3 text-left align-middle text-[11px] font-semibold uppercase tracking-wide text-[var(--text-secondary)]",
        className
      )}
      {...props}
    />
  );
}

export function DataTableCell({
  className,
  ...props
}: React.TdHTMLAttributes<HTMLTableCellElement>) {
  return (
    <td
      className={cn("px-3 py-2.5 align-middle text-foreground", className)}
      {...props}
    />
  );
}
