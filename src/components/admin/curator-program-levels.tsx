import Link from "next/link";
import { ExternalLink, MapPin } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { UniversityMonogram } from "@/components/university-monogram";
import { formatDate } from "@/lib/utils";
import {
  labelApplicantCategory,
  labelFactConfidence,
  labelFactField,
  labelFactFreshness,
  labelFactOrigin,
  labelOf,
} from "@/lib/labels";
import {
  humanizeLanguage,
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

function accessText(match: CuratorMatchView): string | null {
  let access: string | null = null;
  if (match.accessMode === "OPEN") {
    access = match.seatsUnlimited ? "Свободный доступ, без лимита мест" : "Свободный доступ";
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
  if (match.selection === "NONE") return "Вступительный экзамен не требуется";
  if (match.exams.length > 0) return match.exams.map((e) => e.label).join(", ");
  return null;
}

function languageText(match: CuratorMatchView): string | null {
  const teaching = humanizeLanguage(
    match.teachingLanguages[0] ?? match.language
  );
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
      (teaching && reqLower.includes(teaching.toLowerCase()))
    ) {
      return requirement;
    }
    return `${teaching} ${requirement}`;
  }
  return teaching || requirement || null;
}

function seatsText(match: CuratorMatchView): string | null {
  if (match.seatsUnlimited) return "Без лимита мест";
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
      return indicative
        .map((seat) => {
          const scopeLabel = seat.scope
            ? labelApplicantCategory(seat.scope)
            : null;
          return scopeLabel && scopeLabel !== "Не указано"
            ? `Для ${scopeLabel}: ${seat.places} мест`
            : `${seat.places} мест`;
        })
        .join(" · ");
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
    (seat) => normalizeYear(seat.academicYear) !== intakeYear
  );
  const exact = match.applicantCategory
    ? seats.filter((seat) => seat.scope === match.applicantCategory)
    : [];
  return exact.length > 0 ? exact : seats;
}

function indicativeSeatsNote(match: CuratorMatchView): string | null {
  const sourceYear = indicativeSeatsForMatch(match)[0]?.academicYear;
  if (!sourceYear) return null;
  return (
    previousYearCallNote(sourceYear, match.intake, null) ??
    `Ориентир по местам за ${sourceYear}`
  );
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
    statusValue?.unlimited || statusValue?.nonEu != null || statusValue?.eu != null
  );
}

function fieldReason(
  match: CuratorMatchView,
  field: "access" | "exams" | "seats" | "admissionCall"
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
          match.indicativeFromYear
        ) ?? unknownFieldReasonLabel(status.reason, match.intake)
      );
    }
    return unknownFieldReasonLabel(
      status.reason as FieldUnknownReason,
      match.intake || status.targetIntakeYear
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

type ConditionEvidence = {
  field: string;
  quote?: string | null;
  sourceUrl?: string | null;
};

function evidenceForCondition(
  match: CuratorMatchView,
  fields: string[]
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

function DecisionRow({
  label,
  value,
  reason,
  note,
  evidence = [],
  highlightOpenAccess = false,
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
  highlightOpenAccess?: boolean;
  confirmField?: string;
  studentId: string;
  programAcademicYearId: string;
  applicantCategory?: string;
}) {
  return (
    <div className="inline-flex max-w-full self-start justify-self-start flex-col items-start gap-1">
      <p className="text-[11px] text-muted-foreground">{label}</p>
      <div
        className={
          highlightOpenAccess
            ? "w-fit max-w-full rounded-2xl border border-dashed border-emerald-300 bg-emerald-50/60 transition-colors hover:border-emerald-400"
            : "w-fit max-w-full rounded-2xl border border-border bg-card/60 transition-colors hover:border-[var(--brand)]/40"
        }
      >
        <details className="group">
          <summary className="cursor-pointer list-none px-2.5 py-2 [&::-webkit-details-marker]:hidden">
          <div className="min-w-0">
            <div className="min-w-0">
              {value ? (
                <>
                  <p className="whitespace-pre-line text-sm font-medium">{value}</p>
                  {note ? (
                    <p className="mt-0.5 text-xs text-muted-foreground">{note}</p>
                  ) : null}
                </>
              ) : (
                <p className="text-sm text-muted-foreground">{reason}</p>
              )}
            </div>
          </div>
          </summary>
          <div className="border-t border-border/70 bg-muted/30 px-2.5 py-2 text-xs">
          {evidence.length > 0 ? (
            <ul className="space-y-2">
              {evidence.map((item, index) => (
                <li key={`${item.field}-${index}-${item.sourceUrl ?? "no-url"}`}>
                  {evidence.length > 1 ? (
                    <p className="font-medium">{labelFactField(item.field)}</p>
                  ) : null}
                  {item.quote ? (
                    <p className="text-muted-foreground italic">
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
                      className="mt-1 inline-flex items-center gap-1 text-[var(--brand)] hover:underline"
                    >
                      <ExternalLink className="h-3 w-3" />
                      Открыть официальный источник
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
          </div>
        </details>
        {!value && confirmField ? (
          <details className="border-t border-border/70 px-3 py-2">
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
            <select
              name="applicantCategory"
              defaultValue={applicantCategory || "UNKNOWN"}
              required
              className="h-7 rounded-xl border border-input bg-card px-2 text-xs"
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
                className="h-7 rounded-xl border border-input bg-card px-2 text-xs"
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
                className="h-7 w-24 rounded-xl border border-input bg-card px-2 text-xs"
              />
            ) : null}
            {confirmField === "examsDisplay" ? (
              <input
                name="examsDisplay"
                type="text"
                placeholder="Экзамен"
                required
                className="h-7 w-40 rounded-xl border border-input bg-card px-2 text-xs"
              />
            ) : null}
            <input
              name="manualSourceUrl"
              type="url"
              placeholder="Ссылка на официальный источник"
              required
              className="h-7 w-52 rounded-xl border border-input bg-card px-2 text-xs"
            />
            <input
              name="evidenceQuote"
              type="text"
              placeholder="Точная цитата"
              required
              className="h-7 w-52 rounded-xl border border-input bg-card px-2 text-xs"
            />
            <Button type="submit" size="sm">
              Сохранить
            </Button>
          </form>
          </details>
        ) : null}
      </div>
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
  const language = languageText(match);
  const shortlistLabel = match.onShortlist
    ? "В коротком списке"
    : SHORTLIST_LABELS[match.curatorStatus] ?? "Автоподбор";
  const access = accessText(match);
  const exams = examsText(match);
  const seats = seatsText(match);
  const seatsOrientir =
    seats && !hasConfirmedSeats(match) ? indicativeSeatsNote(match) : null;
  const callFreshness =
    match.callFreshness === "current"
      ? `Опубликован набор ${match.academicYear}`
      : null;

  return (
    <article
      id={`program-${match.programAcademicYearId}`}
      className={`overflow-hidden surface-card${
        match.accessMode === "OPEN" ? " surface-card--open-admission" : ""
      }`}
    >
      <div className="space-y-3 border-b border-border px-5 py-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex min-w-0 items-start gap-3">
            <UniversityMonogram name={match.universityName} size="sm" />
            <div className="min-w-0">
              <h3 className="text-[17px] font-semibold tracking-tight text-foreground">
                {match.universityName}
              </h3>
              <p className="text-[13px] font-medium">{match.programName}</p>
              <p className="mt-1 flex flex-wrap gap-x-2 text-[13px] text-muted-foreground">
                {match.city ? (
                  <span className="inline-flex items-center gap-1">
                    <MapPin className="h-3 w-3" />
                    {match.city}
                  </span>
                ) : null}
                {language ? <span>{language}</span> : null}
                <span>{labelOf(match.degreeLevel)}</span>
                <span>{match.academicYear}</span>
              </p>
            </div>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="surface-chip rounded-full px-2.5 py-1 text-[12px] font-semibold tabular-nums text-[var(--brand)]">
              Совпадение {match.fitScore}/100
            </span>
            <Badge variant={match.onShortlist ? "success" : "muted"}>
              {shortlistLabel}
            </Badge>
          </div>
        </div>
      </div>

      <div className="px-4 py-3">
        <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          Проверить перед коротким списком
        </p>
        <div className="grid items-start justify-items-start gap-x-4 gap-y-3 sm:grid-cols-2">
          <DecisionRow
            label="Доступ и отбор"
            value={access}
            reason={fieldReason(match, "access")}
            evidence={evidenceForCondition(match, ["ACCESS_TYPE", "SELECTION"])}
            highlightOpenAccess={match.accessMode === "OPEN"}
            confirmField="accessMode"
            studentId={match.studentId}
            programAcademicYearId={match.programAcademicYearId}
            applicantCategory={match.applicantCategory}
          />
          <DecisionRow
            label="Язык"
            value={language || null}
            reason="Язык и требование не опубликованы"
            evidence={evidenceForCondition(match, ["LANGUAGE_REQUIREMENT"])}
            studentId={match.studentId}
            programAcademicYearId={match.programAcademicYearId}
            applicantCategory={match.applicantCategory}
          />
          <DecisionRow
            label="Экзамены"
            value={exams}
            reason={fieldReason(match, "exams")}
            evidence={evidenceForCondition(match, ["ADMISSION_EXAMS", "SELECTION"])}
            confirmField="examsDisplay"
            studentId={match.studentId}
            programAcademicYearId={match.programAcademicYearId}
            applicantCategory={match.applicantCategory}
          />
          <DecisionRow
            label="Места для категории"
            value={seats}
            reason={fieldReason(match, "seats")}
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
        </div>
        {callFreshness ? (
          <p className="mt-2 text-xs text-muted-foreground">{callFreshness}</p>
        ) : null}
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
          {match.verifiedFacts && match.verifiedFacts.some(
            (fact) => !["TUITION", "APPLICATION_DEADLINE"].includes(fact.field)
          ) ? (
            <div>
              <p className="text-muted-foreground">Ручные подтверждения</p>
              <ul className="mt-1 space-y-0.5">
                {match.verifiedFacts
                  .filter((fact) => !["TUITION", "APPLICATION_DEADLINE"].includes(fact.field))
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
          {match.changeEvents && match.changeEvents.some(
            (event) => !["TUITION", "APPLICATION_DEADLINE"].includes(event.field)
          ) ? (
            <div>
              <p className="text-muted-foreground">История изменений</p>
              <ul className="mt-1 space-y-0.5">
                {match.changeEvents
                  .filter((event) => !["TUITION", "APPLICATION_DEADLINE"].includes(event.field))
                  .slice(0, 8)
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
          {match.criticalFacts && match.criticalFacts.some(
            (fact) => !["TUITION", "APPLICATION_DEADLINE"].includes(fact.field)
          ) ? (
            <div>
              <p className="text-muted-foreground">Доказанные поля</p>
              <ul className="mt-1 space-y-1">
                {match.criticalFacts
                  .filter((fact) => !["TUITION", "APPLICATION_DEADLINE"].includes(fact.field))
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
                    <span className="font-medium">{labelFactField(f.field)}</span>
                    {meta.length > 0 ? ` · ${meta.join(" · ")}` : ""}
                    {f.quote ? (
                      <span className="block text-muted-foreground italic">
                        «{f.quote.slice(0, 120)}»
                      </span>
                    ) : null}
                    {f.sourceUrl ? (
                      <a
                        href={f.sourceUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="text-[var(--brand)] hover:underline"
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
          {match.aiEnrichment ? (
            <div className="rounded-xl bg-muted/40 px-2 py-1.5 text-muted-foreground">
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
              {match.aiEnrichment.date
                ? ` · ${match.aiEnrichment.date}`
                : ""}
              {` · документов: ${match.aiEnrichment.documentCount}`}
            </div>
          ) : null}
          {match.campuses && match.campuses.length > 0 ? (
            <div>
              <p className="text-muted-foreground">Кампусы (доказано)</p>
              <ul className="mt-1 space-y-0.5">
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
              Город кампуса неизвестен (штаб-квартира вуза: {match.universityCity})
            </p>
          ) : null}
          {match.deferredCoverage ? (
            <p className="text-muted-foreground">
              Отложенный охват Universitaly: {match.deferredCoverage}
            </p>
          ) : null}
          {match.whyIncluded ? (
            <p className="text-muted-foreground">
              Почему в подборе: {match.whyIncluded}
            </p>
          ) : null}
          {catalog ? null : (
            <div className="flex flex-wrap gap-2 pt-1">
            {match.selectionReady ? (
              <form action={reviewProgramMatchAction}>
                <input type="hidden" name="studentId" value={match.studentId} />
                <input type="hidden" name="matchId" value={match.matchId} />
                <input type="hidden" name="status" value="SHORTLISTED" />
                <Button type="submit" size="sm">
                  В короткий список
                </Button>
              </form>
            ) : (
              <span className="text-xs text-muted-foreground">
                Shortlist недоступен: нет подтверждённых условий поступления.
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
                {match.monitoringSelected
                  ? "Снять с мониторинга"
                  : "Мониторинг (до 5)"}
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
            ) : match.selectionReady ? (
              <form action={createApplicationAction}>
                <input
                  type="hidden"
                  name="commandId"
                  value={crypto.randomUUID()}
                />
                <input type="hidden" name="studentId" value={match.studentId} />
                <input type="hidden" name="programId" value={match.programId} />
                <input
                  type="hidden"
                  name="programAcademicYearId"
                  value={match.programAcademicYearId}
                />
                <input type="hidden" name="intake" value={match.intake} />
                <Button type="submit" size="sm" variant="outline">
                  Создать заявку
                </Button>
              </form>
            ) : null}
            </div>
          )}
        </div>
      </details>
    </article>
  );
}
