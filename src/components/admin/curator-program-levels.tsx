import Link from "next/link";
import { ExternalLink, MapPin } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { formatDate } from "@/lib/utils";
import {
  humanizeLanguage,
  humanizeWhyFits,
  previousYearCallNote,
} from "@/server/services/student-journey/humanize";
import { unknownFieldReasonLabel } from "@/server/services/work-queue/field-reasons";
import type { FieldUnknownReason } from "@/lib/program-matching/field-status";
import { isFieldFilled } from "@/lib/program-matching/field-status";
import type { CuratorMatchView } from "@/components/curator-program-match-card";
import {
  reviewProgramMatchAction,
  createApplicationAction,
  verifyProgramDossierFactsAction,
} from "@/server/actions";

const SHORTLIST_LABELS: Record<string, string> = {
  SHORTLISTED: "В shortlist",
  APPROVED: "Одобрена",
  NEEDS_REVIEW: "На проверке",
  AUTO_MATCHED: "Автоподбор",
  REJECTED: "Отклонена",
  SELECTED: "Выбрана",
};

function tuitionText(match: CuratorMatchView): string | null {
  if (match.tuitionFixed != null) return `€${match.tuitionFixed}`;
  if (match.tuitionMin != null && match.tuitionMax != null) {
    return match.tuitionMin === match.tuitionMax
      ? `€${match.tuitionMin}`
      : `€${match.tuitionMin}–${match.tuitionMax}`;
  }
  if (match.tuitionMin != null) return `от €${match.tuitionMin}`;
  if (match.tuitionMax != null) return `до €${match.tuitionMax}`;
  return null;
}

function accessText(match: CuratorMatchView): string | null {
  if (match.accessMode === "OPEN") {
    return match.seatsUnlimited ? "Свободный доступ, без лимита мест" : "Свободный доступ";
  }
  if (match.accessMode === "CLOSED") {
    return match.nonEuSeats != null
      ? `Конкурс · ${match.nonEuSeats} мест non-EU`
      : "Конкурсный набор";
  }
  return null;
}

function examsText(match: CuratorMatchView): string | null {
  if (match.examsDisplay) return match.examsDisplay;
  if (match.selection === "NONE") return "Вступительный экзамен не требуется";
  if (match.exams.length > 0) return match.exams.map((e) => e.label).join(", ");
  return null;
}

function seatsText(match: CuratorMatchView): string | null {
  if (match.seatsUnlimited) return "Без лимита мест";
  const parts: string[] = [];
  if (match.euSeats != null) parts.push(`EU: ${match.euSeats}`);
  if (match.nonEuSeats != null) parts.push(`non-EU: ${match.nonEuSeats}`);
  return parts.length ? parts.join(" · ") : null;
}

function fieldReason(
  match: CuratorMatchView,
  field: "tuition" | "deadline" | "access" | "exams" | "seats" | "admissionCall"
): string {
  const status = match.fieldStatuses?.[field];
  if (status && !isFieldFilled(status) && status.reason) {
    return unknownFieldReasonLabel(
      status.reason as FieldUnknownReason,
      match.intake || status.targetIntakeYear
    );
  }
  if (match.callFreshness === "indicative" || match.indicativeFromYear) {
    return (
      previousYearCallNote(
        match.academicYear,
        match.intake,
        match.indicativeFromYear
      ) ?? "Есть ориентир за прошлый год"
    );
  }
  if (match.callFreshness === "unknown") {
    return unknownFieldReasonLabel(
      "NOT_PUBLISHED_FOR_TARGET_YEAR",
      match.intake
    );
  }
  return "Нужна ручная проверка куратора";
}

function DecisionRow({
  label,
  value,
  reason,
  confirmField,
  studentId,
  programAcademicYearId,
}: {
  label: string;
  value: string | null;
  reason: string;
  confirmField: string;
  studentId: string;
  programAcademicYearId: string;
}) {
  return (
    <div className="flex flex-col gap-1 border-b border-border/70 py-2 last:border-0 sm:flex-row sm:items-start sm:justify-between">
      <div className="min-w-0">
        <p className="text-[11px] text-muted-foreground">{label}</p>
        {value ? (
          <p className="text-sm font-medium">{value}</p>
        ) : (
          <p className="text-sm text-muted-foreground">{reason}</p>
        )}
      </div>
      {!value ? (
        <details className="shrink-0">
          <summary className="cursor-pointer text-xs text-[var(--brand)]">
            Подтвердить вручную
          </summary>
          <form
            action={verifyProgramDossierFactsAction}
            className="mt-2 flex flex-wrap items-end gap-2"
          >
            <input type="hidden" name="studentId" value={studentId} />
            <input
              type="hidden"
              name="programAcademicYearId"
              value={programAcademicYearId}
            />
            {confirmField === "deadline" ? (
              <input
                name="deadline"
                type="date"
                required
                className="h-7 rounded-md border border-input bg-card px-2 text-xs"
              />
            ) : null}
            {confirmField === "tuitionMin" ? (
              <input
                name="tuitionMin"
                type="number"
                placeholder="€"
                required
                className="h-7 w-24 rounded-md border border-input bg-card px-2 text-xs"
              />
            ) : null}
            {confirmField === "accessMode" ? (
              <select
                name="accessMode"
                className="h-7 rounded-md border border-input bg-card px-2 text-xs"
                defaultValue="OPEN"
              >
                <option value="OPEN">Свободный доступ</option>
                <option value="CLOSED">Конкурс</option>
              </select>
            ) : null}
            {confirmField === "nonEuSeats" ? (
              <input
                name="nonEuSeats"
                type="number"
                placeholder="Места"
                required
                className="h-7 w-24 rounded-md border border-input bg-card px-2 text-xs"
              />
            ) : null}
            {confirmField === "examsDisplay" ? (
              <input
                name="examsDisplay"
                type="text"
                placeholder="Экзамен"
                required
                className="h-7 w-40 rounded-md border border-input bg-card px-2 text-xs"
              />
            ) : null}
            <Button type="submit" size="sm">
              Сохранить
            </Button>
          </form>
        </details>
      ) : null}
    </div>
  );
}

export function CuratorProgramLevelsCard({
  match,
  focused = false,
  catalog = false,
}: {
  match: CuratorMatchView;
  focused?: boolean;
  catalog?: boolean;
}) {
  const language =
    humanizeLanguage(match.languageRequirement) ||
    humanizeLanguage(match.teachingLanguages[0] ?? match.language);
  const whyFits = humanizeWhyFits(match.reasons);
  const shortlistLabel = match.onShortlist
    ? "В shortlist"
    : SHORTLIST_LABELS[match.curatorStatus] ?? "Автоподбор";
  const tuition = tuitionText(match);
  const access = accessText(match);
  const exams = examsText(match);
  const seats = seatsText(match);
  const deadline = match.deadline
    ? formatDate(match.deadline)
    : null;
  const callFreshness =
    match.callFreshness === "current"
      ? `Опубликован call ${match.academicYear}`
      : match.callFreshness === "indicative" || match.indicativeFromYear
        ? previousYearCallNote(
            match.academicYear,
            match.intake,
            match.indicativeFromYear
          ) ?? "Есть ориентир за прошлый год"
        : unknownFieldReasonLabel(
            "NOT_PUBLISHED_FOR_TARGET_YEAR",
            match.intake
          );

  return (
    <article
      id={`program-${match.programAcademicYearId}`}
      className="overflow-hidden rounded-lg border border-border bg-white shadow-sm"
    >
      <div className="space-y-2 border-b border-border px-4 py-3">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <h3 className="text-[15px] font-semibold text-[var(--brand)]">
              {match.universityName}
            </h3>
            <p className="text-sm font-medium">{match.programName}</p>
            <p className="mt-1 flex flex-wrap gap-x-2 text-xs text-muted-foreground">
              {match.city ? (
                <span className="inline-flex items-center gap-1">
                  <MapPin className="h-3 w-3" />
                  {match.city}
                </span>
              ) : null}
              {language ? <span>{language}</span> : null}
            </p>
          </div>
          <Badge variant={match.onShortlist ? "success" : "muted"}>
            {shortlistLabel}
          </Badge>
        </div>
        {whyFits ? (
          <p className="text-sm text-foreground">{whyFits}</p>
        ) : null}
      </div>

      <div className="px-4 py-3">
        <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          Решение
        </p>
        <DecisionRow
          label="Актуальность call"
          value={match.callFreshness === "current" ? callFreshness : null}
          reason={callFreshness}
          confirmField="deadline"
          studentId={match.studentId}
          programAcademicYearId={match.programAcademicYearId}
        />
        <DecisionRow
          label="Доступ"
          value={access}
          reason={fieldReason(match, "access")}
          confirmField="accessMode"
          studentId={match.studentId}
          programAcademicYearId={match.programAcademicYearId}
        />
        <DecisionRow
          label="Экзамены"
          value={exams}
          reason={fieldReason(match, "exams")}
          confirmField="examsDisplay"
          studentId={match.studentId}
          programAcademicYearId={match.programAcademicYearId}
        />
        <DecisionRow
          label="Tuition"
          value={tuition}
          reason={fieldReason(match, "tuition")}
          confirmField="tuitionMin"
          studentId={match.studentId}
          programAcademicYearId={match.programAcademicYearId}
        />
        <DecisionRow
          label="Дедлайн"
          value={deadline}
          reason={fieldReason(match, "deadline")}
          confirmField="deadline"
          studentId={match.studentId}
          programAcademicYearId={match.programAcademicYearId}
        />
        <DecisionRow
          label="Квоты"
          value={seats}
          reason={fieldReason(match, "seats")}
          confirmField="nonEuSeats"
          studentId={match.studentId}
          programAcademicYearId={match.programAcademicYearId}
        />
      </div>

      <details className="border-t border-border px-4 py-3" open={focused}>
        <summary className="cursor-pointer text-xs font-medium text-muted-foreground">
          Детали: источники и подтверждения
        </summary>
        <div className="mt-3 space-y-3 text-xs">
          {match.sourceUrls.length > 0 ? (
            <div>
              <p className="text-muted-foreground">Источники</p>
              <ul className="mt-1 space-y-1">
                {match.sourceUrls.slice(0, 4).map((url) => (
                  <li key={url}>
                    <a
                      href={url}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 text-[var(--brand)] hover:underline"
                    >
                      <ExternalLink className="h-3 w-3" />
                      Проверить источник
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <p className="text-muted-foreground">Нужна проверка источника</p>
          )}
          {match.extractQuality &&
          ["LOW_EXTRACTION_QUALITY", "NEEDS_REVIEW", "MANUAL_REVIEW_REQUIRED"].includes(
            match.extractQuality
          ) ? (
            <p className="text-muted-foreground">
              Качество извлечения: нужна проверка куратора
            </p>
          ) : null}
          {match.verifiedFacts && match.verifiedFacts.length > 0 ? (
            <div>
              <p className="text-muted-foreground">Ручные подтверждения</p>
              <ul className="mt-1 space-y-0.5">
                {match.verifiedFacts.map((fact) => (
                  <li key={fact.field}>
                    {fact.field}
                    {fact.verifiedAt ? ` · ${formatDate(fact.verifiedAt)}` : ""}
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <p className="text-muted-foreground">Ручных подтверждений пока нет</p>
          )}
          {match.changeEvents && match.changeEvents.length > 0 ? (
            <div>
              <p className="text-muted-foreground">История изменений</p>
              <ul className="mt-1 space-y-0.5">
                {match.changeEvents.slice(0, 8).map((event) => (
                  <li key={event.id}>
                    {event.field}
                    {event.createdAt ? ` · ${formatDate(event.createdAt)}` : ""}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          {catalog ? null : (
            <div className="flex flex-wrap gap-2 pt-1">
            <form action={reviewProgramMatchAction}>
              <input type="hidden" name="studentId" value={match.studentId} />
              <input type="hidden" name="matchId" value={match.matchId} />
              <input type="hidden" name="status" value="SHORTLISTED" />
              <Button type="submit" size="sm">
                В shortlist
              </Button>
            </form>
            {match.alreadyApplied && match.applicationId ? (
              <Button asChild size="sm" variant="outline">
                <Link
                  href={`/admin/students/${match.studentId}/applications/${match.applicationId}`}
                >
                  Открыть заявку
                </Link>
              </Button>
            ) : (
              <form action={createApplicationAction}>
                <input type="hidden" name="studentId" value={match.studentId} />
                <input type="hidden" name="programId" value={match.programId} />
                <input type="hidden" name="intake" value={match.intake} />
                <Button type="submit" size="sm" variant="outline">
                  Создать заявку
                </Button>
              </form>
            )}
            </div>
          )}
        </div>
      </details>
    </article>
  );
}
