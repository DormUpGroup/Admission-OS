import Link from "next/link";
import { LayoutGrid, List } from "lucide-react";
import { CuratorProgramLevelsCard } from "@/components/admin/curator-program-levels";
import { CuratorProgramMatchList } from "@/components/admin/curator-program-match-list";
import type { CuratorMatchView } from "@/components/curator-program-match-card";
import { cn } from "@/lib/utils";

export function MatchViewToggle({
  view,
  viewHref,
}: {
  view: "grid" | "list";
  viewHref: (next: "grid" | "list") => string;
}) {
  return (
    <div
      className="inline-flex rounded-[var(--radius-control)] border border-border bg-card p-0.5"
      role="group"
      aria-label="Вид списка программ"
    >
      <Link
        href={viewHref("grid")}
        className={cn(
          "inline-flex items-center gap-1 rounded-[calc(var(--radius-control)-2px)] px-2 py-1 text-[12px] font-medium transition-colors",
          view === "grid"
            ? "bg-[var(--brand-soft)] text-[var(--brand-fg)]"
            : "text-muted-foreground hover:text-foreground",
        )}
        aria-current={view === "grid" ? "true" : undefined}
      >
        <LayoutGrid className="h-3.5 w-3.5" />
        Карточки
      </Link>
      <Link
        href={viewHref("list")}
        className={cn(
          "inline-flex items-center gap-1 rounded-[calc(var(--radius-control)-2px)] px-2 py-1 text-[12px] font-medium transition-colors",
          view === "list"
            ? "bg-[var(--brand-soft)] text-[var(--brand-fg)]"
            : "text-muted-foreground hover:text-foreground",
        )}
        aria-current={view === "list" ? "true" : undefined}
      >
        <List className="h-3.5 w-3.5" />
        Список
      </Link>
    </div>
  );
}

export function CuratorMatchesLayout({
  matches,
  focusedId,
  view,
}: {
  matches: CuratorMatchView[];
  focusedId?: string;
  view: "grid" | "list";
}) {
  if (matches.length === 0) return null;

  if (view === "list") {
    return (
      <CuratorProgramMatchList matches={matches} focusedId={focusedId} />
    );
  }

  return (
    <div className="grid gap-3 xl:grid-cols-2">
      {matches.map((m) => (
        <CuratorProgramLevelsCard
          key={m.matchId}
          match={m}
          focused={focusedId === m.programAcademicYearId}
        />
      ))}
    </div>
  );
}
