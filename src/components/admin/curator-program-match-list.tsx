import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DataTable,
  DataTableBody,
  DataTableCell,
  DataTableHead,
  DataTableHeader,
  DataTableRow,
} from "@/components/data-table";
import type { CuratorMatchView } from "@/components/curator-program-match-card";
import {
  matchRequirementSummary,
  verificationPresentation,
} from "@/components/admin/curator-program-levels";
import { reviewProgramMatchAction } from "@/server/actions";
import { labelOf } from "@/lib/labels";
import { cn } from "@/lib/utils";

export function CuratorProgramMatchList({
  matches,
  focusedId,
}: {
  matches: CuratorMatchView[];
  focusedId?: string;
}) {
  if (matches.length === 0) return null;

  return (
    <DataTable>
      <DataTableHeader>
        <DataTableRow>
          <DataTableHead>Университет / программа</DataTableHead>
          <DataTableHead className="w-[88px] text-right">
            Соответствие
          </DataTableHead>
          <DataTableHead>Поступление</DataTableHead>
          <DataTableHead>Экзамен</DataTableHead>
          <DataTableHead>Язык</DataTableHead>
          <DataTableHead>Проверка</DataTableHead>
          <DataTableHead className="w-[120px]">Короткий список</DataTableHead>
        </DataTableRow>
      </DataTableHeader>
      <DataTableBody>
        {matches.map((match) => {
          const { language, access, exams } = matchRequirementSummary(match);
          const verification = verificationPresentation(match);
          const focused = focusedId === match.programAcademicYearId;
          return (
            <DataTableRow
              key={match.matchId}
              className={cn(focused && "bg-[var(--brand-soft)]/40")}
            >
              <DataTableCell>
                <div className="min-w-0 max-w-[280px]">
                  <p className="truncate text-[12px] text-[var(--text-secondary)]">
                    {match.universityName}
                  </p>
                  <Link
                    href={`#program-${match.programAcademicYearId}`}
                    className="block truncate text-[13px] font-semibold leading-snug hover:underline"
                  >
                    {match.programName}
                  </Link>
                  <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
                    {[
                      labelOf(match.degreeLevel),
                      match.academicYear,
                      match.city,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </p>
                </div>
              </DataTableCell>
              <DataTableCell className="text-right">
                <span className="text-[16px] font-semibold tabular-nums text-[var(--brand-fg)]">
                  {match.fitScore}
                </span>
                <span className="text-[11px] text-muted-foreground">/100</span>
              </DataTableCell>
              <DataTableCell className="max-w-[140px] text-[12px]">
                <span className="line-clamp-2">
                  {access || "—"}
                </span>
              </DataTableCell>
              <DataTableCell className="max-w-[120px] text-[12px]">
                <span className="line-clamp-2">{exams || "—"}</span>
              </DataTableCell>
              <DataTableCell className="max-w-[100px] text-[12px]">
                <span className="line-clamp-2">{language || "—"}</span>
              </DataTableCell>
              <DataTableCell>
                <Badge variant={verification.variant}>
                  {verification.label}
                </Badge>
              </DataTableCell>
              <DataTableCell>
                {match.onShortlist ? (
                  <Badge variant="success">В списке</Badge>
                ) : match.selectionReady ? (
                  <form action={reviewProgramMatchAction}>
                    <input
                      type="hidden"
                      name="studentId"
                      value={match.studentId}
                    />
                    <input type="hidden" name="matchId" value={match.matchId} />
                    <input type="hidden" name="status" value="SHORTLISTED" />
                    <Button type="submit" size="sm" variant="outline">
                      Добавить
                    </Button>
                  </form>
                ) : (
                  <span className="text-[11px] text-muted-foreground">—</span>
                )}
              </DataTableCell>
            </DataTableRow>
          );
        })}
      </DataTableBody>
    </DataTable>
  );
}
