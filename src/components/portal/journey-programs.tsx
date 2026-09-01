import Link from "next/link";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { JourneyProgramsBlock } from "@/server/services/student-journey/types";

const PREVIEW_STATUS_CLASS: Record<string, string> = {
  SELECTED: "bg-[var(--ok-bg)] text-[var(--ok-fg)]",
  NEEDS_CHOICE: "bg-[var(--warning-bg)] text-[var(--warning-fg)]",
  CURATOR_REVIEWING: "bg-[var(--warning-bg)] text-[var(--warning-fg)]",
};

export function JourneyPrograms({ programs }: { programs: JourneyProgramsBlock }) {
  return (
    <section className="space-y-3">
      <div className="flex items-end justify-between gap-3">
        <h2 className="text-sm font-semibold text-[var(--foreground)]">
          Программы
        </h2>
        <Button asChild variant="ghost" size="sm" className="h-11 px-3 sm:h-8">
          <Link href={programs.allHref}>Все программы</Link>
        </Button>
      </div>

      <div className="rounded-2xl border border-[var(--border)] bg-white px-4 py-4">
        <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm">
          <p>
            <span className="text-muted-foreground">На рассмотрении: </span>
            <span className="font-medium tabular-nums">
              {programs.consideringCount}{" "}
              {pluralPrograms(programs.consideringCount)}
            </span>
          </p>
          <p>
            <span className="text-muted-foreground">Выбрано: </span>
            <span className="font-medium tabular-nums">
              {programs.selectedCount} {pluralPrograms(programs.selectedCount)}
            </span>
          </p>
        </div>
      </div>

      {programs.previews.length > 0 ? (
        <ul className="grid grid-cols-1 gap-3">
          {programs.previews.map((preview) => (
            <li
              key={preview.programId}
              className="rounded-2xl border border-[var(--border)] bg-white px-4 py-4"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-[15px] font-semibold text-[var(--brand)]">
                    {preview.universityName}
                  </p>
                  <p className="mt-0.5 text-sm text-[var(--foreground)]">
                    {preview.programName}
                  </p>
                </div>
                <span
                  className={cn(
                    "shrink-0 rounded-md px-2 py-1 text-[11px] font-medium",
                    PREVIEW_STATUS_CLASS[preview.status] ??
                      "bg-muted text-muted-foreground"
                  )}
                >
                  {preview.statusLabel}
                </span>
              </div>
              <p className="mt-2 text-xs text-muted-foreground">
                {[preview.city, preview.language].filter(Boolean).join(" · ")}
              </p>
              {preview.whyFits ? (
                <p className="mt-2 text-sm text-[var(--foreground)]">
                  <span className="text-muted-foreground">Почему подходит: </span>
                  {preview.whyFits}
                </p>
              ) : null}
              {preview.previousYearNote ? (
                <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
                  {preview.previousYearNote}
                </p>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}

function pluralPrograms(n: number) {
  const n10 = n % 10;
  const n100 = n % 100;
  if (n10 === 1 && n100 !== 11) return "программа";
  if (n10 >= 2 && n10 <= 4 && (n100 < 12 || n100 > 14)) return "программы";
  return "программ";
}
