import Link from "next/link";
import { cn } from "@/lib/utils";

export type FilterPillItem = {
  id: string;
  label: string;
  href: string;
};

export function FilterPills({
  items,
  activeId,
  className,
}: {
  items: FilterPillItem[];
  activeId: string;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-wrap items-center gap-1.5",
        className
      )}
    >
      {items.map((item) => {
        const active = item.id === activeId;
        return (
          <Link
            key={item.id}
            href={item.href}
            className={cn(
              "rounded-[var(--radius-badge)] border px-2.5 py-1 text-[12px] font-medium transition-colors",
              active
                ? "border-[var(--brand-muted)] bg-[var(--brand-soft)] text-[var(--brand-fg)]"
                : "border-border bg-card text-[var(--text-secondary)] hover:bg-muted hover:text-foreground"
            )}
          >
            {item.label}
          </Link>
        );
      })}
    </div>
  );
}
