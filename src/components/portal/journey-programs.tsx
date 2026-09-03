import Link from "next/link";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { UniversityMonogram } from "@/components/university-monogram";
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
        <h2 className="text-[20px] font-semibold tracking-tight text-foreground">
          Программы
        </h2>
        <Button asChild variant="ghost" size="sm">
          <Link href={programs.allHref}>Все программы</Link>
        </Button>
      </div>

      <div className="surface-card px-5 py-4">
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
              className="surface-card px-5 py-4"
            >
              <div className="flex items-start gap-3.5">
                <UniversityMonogram name={preview.universityName} size="sm" />
                <div className="min-w-0 flex-1">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-[17px] font-semibold tracking-tight text-foreground">
                        {preview.universityName}
                      </p>
                      <p className="mt-0.5 text-[13px] text-foreground">
                        {preview.programName}
                      </p>
                    </div>
                    <span
                      className={cn(
                        "shrink-0 rounded-full px-2.5 py-1 text-[11px] font-medium",
                        PREVIEW_STATUS_CLASS[preview.status] ??
                          "bg-muted text-muted-foreground"
                      )}
                    >
                      {preview.statusLabel}
                    </span>
                  </div>
              <p className="mt-2 text-[13px] text-muted-foreground">
                {[preview.city, preview.language].filter(Boolean).join(" · ")}
              </p>
              {preview.previousYearNote ? (
                <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
                  {preview.previousYearNote}
                </p>
              ) : null}
                </div>
              </div>
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
