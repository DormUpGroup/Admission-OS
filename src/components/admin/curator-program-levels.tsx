import Link from "next/link";
import { ChevronDown, ExternalLink, MapPin } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { UniversityMonogram } from "@/components/university-monogram";
import { cn, formatDate } from "@/lib/utils";
import {
  labelApplicantCategory,
  labelFactConfidence,
  labelFactField,
  labelFactFreshness,
  labelFactOrigin,
  labelOf,
} from "@/lib/labels";
import {
  formatAcademicYearShort,
  humanizeLanguage,
  previousYearCallNote,
} from "@/server/services/student-journey/humanize";
import { quoteStatesPlaceCount } from "@/server/services/program-ingestion/call-text-parse";
import { unknownFieldReasonLabel } from "@/server/services/work-queue/field-reasons";
import type { FieldUnknownReason } from "@/lib/program-matching/field-status";
import { isFieldFilled } from "@/lib/program-matching/field-status";
import type { CuratorMatchView } from "@/components/curator-program-match-card";
import {
  reviewProgramMatchAction,
  createApplicationAction,
  verifyProgramDossierFactsAction,
  setMonitoringSelectedAction,
} from "@/server/actions";

const SHORTLIST_LABELS: Record<string, string> = {
  SHORTLISTED: "В коротком списке",
  APPROVED: "Одобрена",
  NEEDS_REVIEW: "На проверке",
  AUTO_MATCHED: "Автоподбор",
  REJECTED: "Отклонена",
  SELECTED: "Выбрана",
};

const SCORE_BREAKDOWN_LABELS: Record<string, string> = {
  field: "Направление",
  academicReadiness: "Академическая готовность",
  language: "Язык",
  admissionTest: "Вступительный тест",
  geography: "География",
  budget: "Бюджет",
  scholarship: "Стипендия",
  studyMode: "Формат обучения",
  total: "Итого",
};

function accessText(match: CuratorMatchView): string | null {
  let access: string | null = null;
  if (match.accessMode === "OPEN") {
    access = match.seatsUnlimited
      ? "Свободный доступ, без лимита мест"
      : "Свободный доступ";
  }
  if (match.accessMode === "CLOSED") {
    access = "Конкурс";
  }
  const selection =
    match.selection === "ENTRANCE_EXAM"
      ? "Вступительный экзамен"
      : match.selection === "EVALUATION"
        ? "Оценка / тест"
        : null;
  if (access && selection) return `${access} · ${selection}`;
  return access || selection;
}

function examsText(match: CuratorMatchView): string | null {
  if (match.examsDisplay) return match.examsDisplay;
  if (match.selection === "NONE") return "Не требуется";
  if (match.exams.length > 0) return match.exams.map((e) => e.label).join(", ");
  return null;
}

function teachingLanguageText(match: CuratorMatchView): string | null {
  return humanizeLanguage(match.teachingLanguages[0] ?? match.language);
}

function languageText(match: CuratorMatchView): string | null {
  const teaching = teachingLanguageText(match);
  const reqRaw = (match.languageRequirement ?? "").trim();
  let requirement: string | null = null;
  if (reqRaw) {
    if (/^[ABC][12]\+?$/i.test(reqRaw)) {
      requirement = reqRaw.toUpperCase();
    } else {
      requirement = humanizeLanguage(reqRaw) || reqRaw;
    }
  }

  if (teaching && requirement) {
    const reqLower = requirement.toLowerCase();
    if (
      reqLower.includes("английск") ||
      reqLower.includes("итальянск") ||
      reqLower.includes(teaching.toLowerCase())
    ) {
      return requirement;
    }
    return `${teaching} ${requirement}`;
  }
  return teaching || requirement || null;
}

function seatLine(seat: { places: number; scope: string | null }): string {
  const scopeLabel = seat.scope ? labelApplicantCategory(seat.scope) : null;
  return scopeLabel && scopeLabel !== "Не указано"
    ? `Для ${scopeLabel}: ${seat.places} мест`
    : `${seat.places} мест`;
}

function normalizeSeatYear(value: string | null) {
  return (value || "").match(/20\d{2}/g)?.slice(0, 2).join("/") || value || "";
}

function statedSeatsForIntake(match: CuratorMatchView) {
  const intakeYear = normalizeSeatYear(match.intake);
  return (match.indicativeSeatOptions ?? []).filter((seat) => {
    if (!quoteStatesPlaceCount(seat.places, seat.quote)) return false;
    const year = normalizeSeatYear(seat.academicYear);
    return !year || year === intakeYear;
  });
}

function seatsText(match: CuratorMatchView): string | null {
  if (match.seatsUnlimited) return "Без лимита мест";
  const stated = statedSeatsForIntake(match);
  if (stated.length > 0) return stated.map(seatLine).join(" · ");
  const seatsCount =
    match.quotaSeats ?? match.nonEuSeats ?? match.euSeats ?? null;
  if (seatsCount == null) {
    const statusValue = match.fieldStatuses?.seats?.value as
      | { eu?: number | null; nonEu?: number | null; unlimited?: boolean }
      | null
      | undefined;
    if (statusValue?.unlimited) return "Без лимита мест";
    const fromStatus = statusValue?.nonEu ?? statusValue?.eu;
    if (fromStatus == null) {
      const indicative = indicativeSeatsForMatch(match);
      if (indicative.length === 0) return null;
      return indicative.map(seatLine).join(" · ");
    }
    const scopeLabel = match.quotaScope
      ? labelApplicantCategory(match.quotaScope)
      : null;
    return scopeLabel && scopeLabel !== "Не указано"
      ? `Для ${scopeLabel}: ${fromStatus} мест`
      : `${fromStatus} мест`;
  }
  const scopeLabel = match.quotaScope
    ? labelApplicantCategory(match.quotaScope)
    : null;
  return scopeLabel && scopeLabel !== "Не указано"
    ? `Для ${scopeLabel}: ${seatsCount} мест`
    : `${seatsCount} мест`;
}

function indicativeSeatsForMatch(match: CuratorMatchView) {
  const normalizeYear = (value: string | null) =>
    (value || "").match(/20\d{2}/g)?.slice(0, 2).join("/") || value || "";
  const intakeYear = normalizeYear(match.intake);
  const seats = (match.indicativeSeatOptions ?? []).filter(
    (seat) => normalizeYear(seat.academicYear) !== intakeYear,
  );
  const exact = match.applicantCategory
    ? seats.filter((seat) => seat.scope === match.applicantCategory)
    : [];
  return exact.length > 0 ? exact : seats;
}

function indicativeSeatsNote(match: CuratorMatchView): string | null {
  const sourceYear = indicativeSeatsForMatch(match)[0]?.academicYear;
  const short = formatAcademicYearShort(sourceYear);
  if (!short) return null;
  return `ориентир ${short}`;
}

function hasConfirmedSeats(match: CuratorMatchView): boolean {
  if (
    match.seatsUnlimited ||
    match.quotaSeats != null ||
    match.nonEuSeats != null ||
    match.euSeats != null
  ) {
    return true;
  }
  const statusValue = match.fieldStatuses?.seats?.value as
    | { eu?: number | null; nonEu?: number | null; unlimited?: boolean }
    | null
    | undefined;
  return Boolean(
    statusValue?.unlimited ||
      statusValue?.nonEu != null ||
      statusValue?.eu != null,
  );
}

function fieldReason(
  match: CuratorMatchView,
  field: "access" | "exams" | "seats" | "admissionCall",
): string {
  const status = match.fieldStatuses?.[field];
  if (status && !isFieldFilled(status) && status.reason) {
    if (status.reason === "ONLY_PREVIOUS_YEAR_AVAILABLE") {
      if (field !== "seats") {
        return unknownFieldReasonLabel(status.reason, match.intake);
      }
      return (
        previousYearCallNote(
          status.sourceAcademicYear || match.academicYear,
          match.intake,
          match.indicativeFromYear,
        ) ?? unknownFieldReasonLabel(status.reason, match.intake)
      );
    }
    return unknownFieldReasonLabel(
      status.reason as FieldUnknownReason,
      match.intake || status.targetIntakeYear,
    );
  }
  if (match.callFreshness === "unknown") {
    return unknownFieldReasonLabel(
      "NOT_PUBLISHED_FOR_TARGET_YEAR",
      match.intake,
    );
  }
  return "Нужна ручная проверка куратора";
}

/** Verification of admission data — independent from fitScore. */
export function verificationPresentation(match: CuratorMatchView): {
  label: string;
  variant: "success" | "warning" | "muted" | "info";
} {
  if (match.selectionReady && match.callFreshness === "current") {
    return { label: "Подтверждено", variant: "success" };
  }
  if (match.callFreshness === "indicative") {
    return { label: "Данные устарели", variant: "warning" };
  }
  if (
    match.selectionReady ||
    match.sourceResolved ||
    (match.verifiedFacts && match.verifiedFacts.length > 0) ||
    match.dataConfidence === "MEDIUM"
  ) {
    return { label: "Частично проверено", variant: "warning" };
  }
  return { label: "Требует проверки", variant: "muted" };
}

type ConditionEvidence = {
  field: string;
  quote?: string | null;
  sourceUrl?: string | null;
};

function evidenceForCondition(
  match: CuratorMatchView,
  fields: string[],
): ConditionEvidence[] {
  const seen = new Set<string>();
  return (match.criticalFacts ?? [])
    .filter((fact) => fields.includes(fact.field))
    .filter((fact) => {
      const key = `${fact.field}|${fact.sourceUrl ?? ""}|${fact.quote ?? ""}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .map((fact) => ({
      field: fact.field,
      quote: fact.quote,
      sourceUrl: fact.sourceUrl,
    }));
}

function indicativeSeatEvidence(match: CuratorMatchView): ConditionEvidence[] {
  return indicativeSeatsForMatch(match).map((seat) => ({
    field: "SEATS",
    quote: seat.quote,
    sourceUrl: seat.sourceUrl,
  }));
}

function RequirementCell({
  label,
  value,
  reason,
  note,
  evidence = [],
  emphasize = false,
  confirmField,
  studentId,
  programAcademicYearId,
  applicantCategory,
}: {
  label: string;
  value: string | null;
  reason: string;
  note?: string | null;
  evidence?: ConditionEvidence[];
  emphasize?: boolean;
  confirmField?: string;
  studentId: string;
  programAcademicYearId: string;
  applicantCategory?: string;
}) {
  const display = value || reason || "Не указано в бандо";
  const unknown = !value;

  return (
    <div className="min-w-0">
      <details className="group">
        <summary className="flex cursor-pointer list-none items-start gap-2 rounded-[var(--radius-control)] py-0.5 outline-none ring-offset-2 focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
          <div className="min-w-0 flex-1">
            <p className="text-[12px] text-[var(--text-secondary)]">{label}</p>
            <p
              className={cn(
                "mt-0.5 text-[13px] leading-snug",
                unknown
                  ? "text-muted-foreground"
                  : emphasize
                    ? "font-medium text-[var(--ok-fg)]"
                    : "font-medium text-foreground",
              )}
            >
              {display}
            </p>
            {note ? (
              <p className="mt-0.5 text-[11px] text-muted-foreground">{note}</p>
            ) : null}
          </div>
          <ChevronDown className="mt-1 h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform group-open:rotate-180" />
        </summary>
        <div className="mt-1.5 space-y-2 rounded-[var(--radius-control)] bg-muted/40 px-2.5 py-2 text-[12px]">
          {evidence.length > 0 ? (
            <ul className="space-y-2">
              {evidence.map((item, index) => (
                <li key={`${item.field}-${index}-${item.sourceUrl ?? "no-url"}`}>
                  {evidence.length > 1 ? (
                    <p className="font-medium">{labelFactField(item.field)}</p>
                  ) : null}
                  {item.quote ? (
                    <p className="italic text-muted-foreground">
                      «{item.quote}»
                    </p>
                  ) : (
                    <p className="text-muted-foreground">
                      Цитата не сохранена — проверьте первоисточник.
                    </p>
                  )}
                  {item.sourceUrl ? (
                    <a
                      href={item.sourceUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="mt-1 inline-flex items-center gap-1 text-[var(--brand-fg)] hover:underline"
                    >
                      <ExternalLink className="h-3 w-3" />
                      Официальный источник
                    </a>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-muted-foreground">
              Источник для этого условия пока не подтверждён.
            </p>
          )}
          {!value && confirmField ? (
            <details className="border-t border-border/60 pt-2">
              <summary className="cursor-pointer text-[12px] font-medium text-[var(--brand-fg)]">
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
                <select
                  name="applicantCategory"
                  defaultValue={applicantCategory || "UNKNOWN"}
                  required
                  className="h-7 rounded-[var(--radius-control)] border border-input bg-card px-2 text-xs"
                >
                  <option value="UNKNOWN" disabled>
                    Категория абитуриента
                  </option>
                  <option value="EU_CITIZEN">Гражданин ЕС</option>
                  <option value="EU_EQUIVALENT">Приравнен к ЕС</option>
                  <option value="NON_EU_RESIDENT_ITALY">
                    Non-EU, резидент Италии
                  </option>
                  <option value="NON_EU_RESIDENT_ABROAD">
                    Non-EU из-за рубежа
                  </option>
                </select>
                {confirmField === "accessMode" ? (
                  <select
                    name="accessMode"
                    className="h-7 rounded-[var(--radius-control)] border border-input bg-card px-2 text-xs"
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
                    className="h-7 w-24 rounded-[var(--radius-control)] border border-input bg-card px-2 text-xs"
                  />
                ) : null}
                {confirmField === "examsDisplay" ? (
                  <input
                    name="examsDisplay"
                    type="text"
                    placeholder="Экзамен"
                    required
                    className="h-7 w-40 rounded-[var(--radius-control)] border border-input bg-card px-2 text-xs"
                  />
                ) : null}
                <input
                  name="manualSourceUrl"
                  type="url"
                  placeholder="Ссылка на официальный источник"
                  required
                  className="h-7 w-52 rounded-[var(--radius-control)] border border-input bg-card px-2 text-xs"
                />
                <input
                  name="evidenceQuote"
                  type="text"
                  placeholder="Точная цитата"
                  required
                  className="h-7 w-52 rounded-[var(--radius-control)] border border-input bg-card px-2 text-xs"
                />
                <Button type="submit" size="sm">
                  Сохранить
                </Button>
              </form>
            </details>
          ) : null}
        </div>
      </details>
    </div>
  );
}

function CardActions({
  match,
  catalog,
}: {
  match: CuratorMatchView;
  catalog: boolean;
}) {
  if (catalog) return null;

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {match.onShortlist ? (
        <Badge variant="success">В коротком списке</Badge>
      ) : match.selectionReady ? (
        <form action={reviewProgramMatchAction}>
          <input type="hidden" name="studentId" value={match.studentId} />
          <input type="hidden" name="matchId" value={match.matchId} />
          <input type="hidden" name="status" value="SHORTLISTED" />
          <Button type="submit" size="sm">
            В короткий список
          </Button>
        </form>
      ) : (
        <span className="text-[11px] text-muted-foreground">
          Shortlist недоступен без подтверждённых условий
        </span>
      )}
      <form action={setMonitoringSelectedAction}>
        <input type="hidden" name="studentId" value={match.studentId} />
        <input type="hidden" name="matchId" value={match.matchId} />
        <input
          type="hidden"
          name="selected"
          value={match.monitoringSelected ? "0" : "1"}
        />
        <Button type="submit" size="sm" variant="outline">
          {match.monitoringSelected ? "Снять мониторинг" : "Мониторинг"}
        </Button>
      </form>
      {match.alreadyApplied && match.applicationId ? (
        <Button asChild size="sm" variant="ghost">
          <Link
            href={`/admin/students/${match.studentId}/applications/${match.applicationId}`}
          >
            Заявка
          </Link>
        </Button>
      ) : match.selectionReady ? (
        <form action={createApplicationAction}>
          <input type="hidden" name="studentId" value={match.studentId} />
          <input type="hidden" name="programId" value={match.programId} />
          <input
            type="hidden"
            name="programAcademicYearId"
            value={match.programAcademicYearId}
          />
          <input type="hidden" name="intake" value={match.intake} />
          <Button type="submit" size="sm" variant="ghost">
            Создать заявку
          </Button>
        </form>
      ) : null}
      <Button asChild size="sm" variant="ghost">
        <Link href={`/admin/programs/${match.programId}`}>Программа</Link>
      </Button>
    </div>
  );
}

function VerificationDetails({
  match,
  open,
}: {
  match: CuratorMatchView;
  open?: boolean;
}) {
  const breakdown = match.scoreBreakdown
    ? Object.entries(match.scoreBreakdown).filter(([key]) => key !== "total")
    : [];

  return (
    <details className="group" open={open}>
      <summary className="flex cursor-pointer list-none items-center gap-1 text-[12px] font-medium text-[var(--text-secondary)] outline-none ring-offset-2 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
        Источники и проверка
        <ChevronDown className="h-3.5 w-3.5 transition-transform group-open:rotate-180" />
      </summary>
      <div className="mt-2.5 space-y-3 text-[12px]">
        {breakdown.length > 0 ? (
          <div>
            <p className="font-medium text-foreground">
              Разбор соответствия ({match.fitScore}/100)
            </p>
            <ul className="mt-1 grid grid-cols-2 gap-x-3 gap-y-0.5 text-muted-foreground">
              {breakdown.map(([key, value]) => (
                <li key={key} className="flex justify-between gap-2">
                  <span>{SCORE_BREAKDOWN_LABELS[key] ?? key}</span>
                  <span className="tabular-nums text-foreground">{value}</span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {match.reasons.length > 0 ? (
          <div>
            <p className="font-medium text-foreground">Почему подходит</p>
            <ul className="mt-1 list-disc space-y-0.5 pl-4 text-muted-foreground">
              {match.reasons.slice(0, 4).map((reason) => (
                <li key={reason}>{reason}</li>
              ))}
            </ul>
          </div>
        ) : null}

        {match.whyIncluded ? (
          <p className="text-muted-foreground">
            Почему в подборе: {match.whyIncluded}
          </p>
        ) : null}

        {match.sourceUrls.length > 0 ? (
          <div>
            <p className="font-medium text-foreground">Источники</p>
            <ul className="mt-1 space-y-1">
              {match.sourceUrls.slice(0, 4).map((url) => (
                <li key={url}>
                  <a
                    href={url}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 break-all text-[var(--brand-fg)] hover:underline"
                  >
                    <ExternalLink className="h-3 w-3 shrink-0" />
                    {url.replace(/^https?:\/\//, "").slice(0, 64)}
                    {url.length > 64 ? "…" : ""}
                  </a>
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <p className="text-muted-foreground">Нужна проверка источника</p>
        )}

        {match.extractQuality &&
        [
          "LOW_EXTRACTION_QUALITY",
          "NEEDS_REVIEW",
          "MANUAL_REVIEW_REQUIRED",
        ].includes(match.extractQuality) ? (
          <p className="text-[var(--warning-fg)]">
            Качество извлечения: нужна проверка куратора
          </p>
        ) : null}

        {match.verifiedFacts &&
        match.verifiedFacts.some(
          (fact) => !["TUITION", "APPLICATION_DEADLINE"].includes(fact.field),
        ) ? (
          <div>
            <p className="font-medium text-foreground">Ручные подтверждения</p>
            <ul className="mt-1 space-y-0.5 text-muted-foreground">
              {match.verifiedFacts
                .filter(
                  (fact) =>
                    !["TUITION", "APPLICATION_DEADLINE"].includes(fact.field),
                )
                .map((fact) => (
                  <li key={fact.field}>
                    {labelFactField(fact.field)}
                    {fact.verifiedAt ? ` · ${formatDate(fact.verifiedAt)}` : ""}
                  </li>
                ))}
            </ul>
          </div>
        ) : (
          <p className="text-muted-foreground">Ручных подтверждений пока нет</p>
        )}

        {match.criticalFacts &&
        match.criticalFacts.some(
          (fact) => !["TUITION", "APPLICATION_DEADLINE"].includes(fact.field),
        ) ? (
          <div>
            <p className="font-medium text-foreground">Доказанные поля</p>
            <ul className="mt-1 space-y-1.5">
              {match.criticalFacts
                .filter(
                  (fact) =>
                    !["TUITION", "APPLICATION_DEADLINE"].includes(fact.field),
                )
                .slice(0, 8)
                .map((f, index) => {
                  const freshness = labelFactFreshness(f.freshness);
                  const scope =
                    f.scope && f.scope !== "ALL"
                      ? labelApplicantCategory(f.scope)
                      : f.scope === "ALL"
                        ? labelApplicantCategory("ALL")
                        : null;
                  const confidence = labelFactConfidence(f.confidence);
                  const origin = labelFactOrigin(f.origin);
                  const meta = [
                    freshness,
                    scope,
                    confidence ? `уверенность ${confidence}` : null,
                    origin,
                  ].filter(Boolean);
                  return (
                    <li key={`${f.field}-${index}-${f.sourceUrl ?? ""}`}>
                      <span className="font-medium text-foreground">
                        {labelFactField(f.field)}
                      </span>
                      {f.value ? (
                        <span className="text-muted-foreground">
                          {" "}
                          — {f.value.slice(0, 80)}
                        </span>
                      ) : null}
                      {meta.length > 0 ? (
                        <span className="block text-[11px] text-muted-foreground">
                          {meta.join(" · ")}
                        </span>
                      ) : null}
                      {f.quote ? (
                        <span className="block italic text-muted-foreground">
                          «{f.quote.slice(0, 120)}»
                        </span>
                      ) : null}
                      {f.sourceUrl ? (
                        <a
                          href={f.sourceUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="text-[var(--brand-fg)] hover:underline"
                        >
                          источник
                        </a>
                      ) : null}
                    </li>
                  );
                })}
            </ul>
          </div>
        ) : null}

        {match.changeEvents &&
        match.changeEvents.some(
          (event) => !["TUITION", "APPLICATION_DEADLINE"].includes(event.field),
        ) ? (
          <div>
            <p className="font-medium text-foreground">История изменений</p>
            <ul className="mt-1 space-y-0.5 text-muted-foreground">
              {match.changeEvents
                .filter(
                  (event) =>
                    !["TUITION", "APPLICATION_DEADLINE"].includes(event.field),
                )
                .slice(0, 6)
                .map((event) => (
                  <li key={event.id}>
                    {labelFactField(event.field)}
                    {event.oldValue && event.newValue
                      ? `: ${event.oldValue.slice(0, 40)} → ${event.newValue.slice(0, 40)}`
                      : ""}
                    {event.createdAt ? ` · ${formatDate(event.createdAt)}` : ""}
                  </li>
                ))}
            </ul>
          </div>
        ) : null}

        {match.aiEnrichment ? (
          <p className="text-muted-foreground">
            Проверка данных:{" "}
            {match.aiEnrichment.disabled
              ? "выключено (fallback regex/PDF)"
              : match.aiEnrichment.reused
                ? "повторно использовано"
                : "новое"}
            {match.aiEnrichment.model === "FALLBACK_REGEX"
              ? " · резервная проверка официального источника"
              : match.aiEnrichment.model
                ? ` · ИИ-проверка (${match.aiEnrichment.model})`
                : ""}
            {match.aiEnrichment.date ? ` · ${match.aiEnrichment.date}` : ""}
            {` · документов: ${match.aiEnrichment.documentCount}`}
          </p>
        ) : null}

        {match.campuses && match.campuses.length > 0 ? (
          <div>
            <p className="font-medium text-foreground">Кампусы</p>
            <ul className="mt-1 space-y-0.5 text-muted-foreground">
              {match.campuses.map((c) => (
                <li key={c.city}>
                  {c.city}
                  {c.quote ? ` — «${c.quote.slice(0, 80)}»` : ""}
                </li>
              ))}
            </ul>
          </div>
        ) : match.universityCity && !match.city ? (
          <p className="text-muted-foreground">
            Город кампуса неизвестен (штаб-квартира вуза: {match.universityCity}
            )
          </p>
        ) : null}

        {match.deferredCoverage ? (
          <p className="text-muted-foreground">
            Отложенный охват Universitaly: {match.deferredCoverage}
          </p>
        ) : null}
      </div>
    </details>
  );
}

export function matchRequirementSummary(match: CuratorMatchView) {
  const language = languageText(match);
  const access = accessText(match);
  const exams = examsText(match);
  const seats = seatsText(match);
  const seatsOrientir =
    seats && !hasConfirmedSeats(match) && statedSeatsForIntake(match).length === 0
      ? indicativeSeatsNote(match)
      : null;
  return { language, access, exams, seats, seatsOrientir };
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
  const teaching = teachingLanguageText(match);
  const { language, access, exams, seats, seatsOrientir } =
    matchRequirementSummary(match);
  const verification = verificationPresentation(match);
  const shortlistLabel = match.onShortlist
    ? "В коротком списке"
    : SHORTLIST_LABELS[match.curatorStatus] ?? null;

  const metaLine = [
    labelOf(match.degreeLevel),
    formatAcademicYearShort(match.academicYear),
    teaching,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <article
      id={`program-${match.programAcademicYearId}`}
      className="surface-card flex flex-col"
    >
      {/* Level 1 — identity + score + verification */}
      <div className="flex items-start gap-3 px-4 pb-3 pt-3.5">
        <UniversityMonogram name={match.universityName} size="sm" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-[13px] text-[var(--text-secondary)]">
            {match.universityName}
          </p>
          <h3 className="mt-0.5 text-[16px] font-semibold leading-snug tracking-tight text-foreground">
            {match.programName}
          </h3>
          {match.city || metaLine ? (
            <p className="mt-1 text-[12px] text-muted-foreground">
              {match.city ? (
                <span className="inline-flex items-center gap-0.5">
                  <MapPin className="h-3 w-3" />
                  {match.city}
                </span>
              ) : null}
              {match.city && metaLine ? " · " : null}
              {metaLine}
            </p>
          ) : null}
          {!match.onShortlist &&
          shortlistLabel &&
          match.curatorStatus !== "AUTO_MATCHED" ? (
            <p className="mt-1 text-[11px] text-muted-foreground">
              {shortlistLabel}
            </p>
          ) : null}
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1.5 text-right">
          <div>
            <p className="text-[11px] text-[var(--text-secondary)]">
              Соответствие
            </p>
            <p className="text-[22px] font-semibold leading-none tabular-nums text-[var(--brand-fg)]">
              {match.fitScore}
              <span className="text-[13px] font-medium text-muted-foreground">
                /100
              </span>
            </p>
          </div>
          <Badge variant={verification.variant}>{verification.label}</Badge>
        </div>
      </div>

      {/* Level 2 — essential requirements */}
      <div className="border-t border-[var(--divider)] px-4 py-2.5">
        <dl className="grid grid-cols-1 gap-x-6 gap-y-2.5 sm:grid-cols-2">
          <RequirementCell
            label="Поступление"
            value={access}
            reason={fieldReason(match, "access")}
            evidence={evidenceForCondition(match, ["ACCESS_TYPE", "SELECTION"])}
            emphasize={match.accessMode === "OPEN"}
            confirmField="accessMode"
            studentId={match.studentId}
            programAcademicYearId={match.programAcademicYearId}
            applicantCategory={match.applicantCategory}
          />
          <RequirementCell
            label="Язык"
            value={language}
            reason="Язык и требование не опубликованы"
            evidence={evidenceForCondition(match, ["LANGUAGE_REQUIREMENT"])}
            studentId={match.studentId}
            programAcademicYearId={match.programAcademicYearId}
            applicantCategory={match.applicantCategory}
          />
          <RequirementCell
            label="Вступительный экзамен"
            value={exams}
            reason={fieldReason(match, "exams")}
            evidence={evidenceForCondition(match, [
              "ADMISSION_EXAMS",
              "SELECTION",
            ])}
            confirmField="examsDisplay"
            studentId={match.studentId}
            programAcademicYearId={match.programAcademicYearId}
            applicantCategory={match.applicantCategory}
          />
          <RequirementCell
            label={`Набор ${formatAcademicYearShort(match.intake || match.academicYear) ?? "—"}`}
            value={seats}
            reason="не указано"
            note={seatsOrientir}
            evidence={[
              ...evidenceForCondition(match, ["SEATS"]),
              ...indicativeSeatEvidence(match),
            ]}
            confirmField="nonEuSeats"
            studentId={match.studentId}
            programAcademicYearId={match.programAcademicYearId}
            applicantCategory={match.applicantCategory}
          />
        </dl>
      </div>

      {/* Level 3 — actions + expandable verification */}
      <div className="mt-auto space-y-2 border-t border-[var(--divider)] bg-muted/25 px-4 py-2.5">
        <CardActions match={match} catalog={catalog} />
        <VerificationDetails match={match} open={focused} />
      </div>
    </article>
  );
}
