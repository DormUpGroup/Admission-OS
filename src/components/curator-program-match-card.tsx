import Link from "next/link";
import { cn } from "@/lib/utils";
import { labelApplicantCategory, labelOf } from "@/lib/labels";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  reviewProgramMatchAction,
  createApplicationAction,
  verifyProgramDossierFactsAction,
} from "@/server/actions";
import { MapPin, ExternalLink } from "lucide-react";
import { UniversityMonogram } from "@/components/university-monogram";
import type { ProgramFieldStatusMap } from "@/lib/program-matching/field-status";

export type CuratorMatchView = {
  matchId: string;
  programId: string;
  programAcademicYearId: string;
  programName: string;
  universityName: string;
  city: string | null;
  region: string | null;
  degreeLevel: string;
  language: string | null;
  teachingLanguages: string[];
  languageRequirement: string | null;
  publicPrivate: string;
  field: string | null;
  academicYear: string;
  applicantCategory?: string;
  eligibilityStatus: string;
  fitScore: number;
  dataConfidence: string;
  curatorStatus: string;
  reasons: string[];
  risks: string[];
  riskNotes: string[];
  missingInformation: string[];
  requirements: Array<{ description: string; status: string }>;
  deadline: Date | string | null;
  tuitionMin: number | null;
  tuitionMax: number | null;
  tuitionFixed: number | null;
  accessMode: string;
  selection?: "NONE" | "EVALUATION" | "ENTRANCE_EXAM" | "UNKNOWN";
  euSeats?: number | null;
  nonEuSeats: number | null;
  quotaSeats?: number | null;
  quotaScope?: string | null;
  seatsUnlimited?: boolean;
  exams: Array<{
    label: string;
    type: string;
    examinerUrl: string | null;
    examinerLabel: string | null;
  }>;
  examsDisplay: string | null;
  careerOutcomes: string | null;
  callFreshness: "current" | "indicative" | "unknown";
  indicativeFromYear: string | null;
  admissionCallUrl?: string | null;
  extractQuality?: string | null;
  sourceUrls: string[];
  alreadyApplied: boolean;
  applicationId?: string;
  studentId: string;
  intake: string;
  scoreBreakdown?: Record<string, number> | null;
  /** Short curator line explaining discovery inclusion. */
  whyIncluded?: string | null;
  inclusionKind?: string | null;
  onShortlist?: boolean;
  fieldStatuses?: ProgramFieldStatusMap | null;
  changeEvents?: Array<{
    id: string;
    field: string;
    oldValue: string | null;
    newValue: string | null;
    createdAt: Date;
  }>;
  verifiedFacts?: Array<{
    field: string;
    verifiedAt: Date | null;
  }>;
  monitoringSelected?: boolean;
  universityCity?: string | null;
  campuses?: Array<{ city: string; quote?: string; sourceUrl?: string }>;
  criticalFacts?: Array<{
    field: string;
    value: string;
    freshness?: string | null;
    scope?: string | null;
    confidence?: string | null;
    origin?: string | null;
    quote?: string | null;
    sourceUrl?: string | null;
  }>;
  aiEnrichment?: {
    date: string | null;
    model: string | null;
    reused: boolean;
    documentCount: number;
    promptVersion?: string | null;
    disabled?: boolean;
  } | null;
  deferredCoverage?: string | null;
};

function statusColor(status: string) {
  switch (status) {
    case "ELIGIBLE":
      return "bg-emerald-50 text-emerald-800 border-emerald-200";
    case "LIKELY_ELIGIBLE":
      return "bg-sky-50 text-sky-800 border-sky-200";
    case "NEEDS_REVIEW":
      return "bg-amber-50 text-amber-900 border-amber-200";
    case "NOT_ELIGIBLE":
      return "bg-rose-50 text-rose-800 border-rose-200";
    default:
      return "bg-muted text-muted-foreground";
  }
}

function callLabel(match: CuratorMatchView) {
  const programYears = match.academicYear.match(/20\d{2}/g) || [];
  const intakeYears = match.intake.match(/20\d{2}/g) || [];
  const sameAcademicYear =
    programYears.length >= 2 &&
    intakeYears.length >= 2 &&
    programYears[0] === intakeYears[0] &&
    programYears[1] === intakeYears[1];
  // A published 2026/27 call is useful context for an applicant targeting
  // 2027/28, but it must not be presented as the current rules for them.
  if (intakeYears.length >= 2 && !sameAcademicYear) {
    return `Ориентир по ${match.academicYear}; условия ${match.intake} ещё не опубликованы`;
  }
  if (match.callFreshness === "current") {
    return `Опубликован набор ${match.academicYear}`;
  }
  if (match.callFreshness === "indicative" && match.indicativeFromYear) {
    return `Ориентир за ${match.indicativeFromYear}`;
  }
  if (match.callFreshness === "indicative") {
    return "Ориентир за прошлый год";
  }
  return "Статус набора неизвестен";
}

function indicativeSuffix(match: CuratorMatchView): string | null {
  if (match.callFreshness === "indicative" || match.indicativeFromYear) {
    return `ориентир ${match.indicativeFromYear || match.academicYear}`;
  }
  const intakeYears = match.intake.match(/20\d{2}/g) || [];
  const programYears = match.academicYear.match(/20\d{2}/g) || [];
  if (
    intakeYears.length >= 2 &&
    programYears.length >= 2 &&
    (programYears[0] !== intakeYears[0] || programYears[1] !== intakeYears[1])
  ) {
    return `ориентир ${match.academicYear}`;
  }
  return null;
}

function withIndicative(label: string, match: CuratorMatchView): string {
  if (label === "UNKNOWN" || label === "Не указано") return "Не указано";
  const suffix = indicativeSuffix(match);
  return suffix ? `${label} · ${suffix}` : label;
}

function tuitionLabel(match: CuratorMatchView) {
  let label = "Стоимость уточняется";
  if (match.tuitionFixed != null) label = `€${match.tuitionFixed}`;
  else {
    const min = match.tuitionMin;
    const max = match.tuitionMax;
    if (min != null && max != null) {
      label = min === max ? `€${min}` : `€${min}–${max}`;
    } else if (min != null) label = `от €${min}`;
    else if (max != null) label = `до €${max}`;
  }
  return withIndicative(label, match);
}

function accessLabel(match: CuratorMatchView) {
  if (match.accessMode === "OPEN") {
    return match.seatsUnlimited
      ? "Свободный доступ · без лимита мест"
      : "Свободный доступ";
  }
  if (match.accessMode === "CLOSED") {
    return "Конкурсный набор";
  }
  return "Не указано";
}

function selectionLabel(match: CuratorMatchView) {
  if (match.selection === "NONE") return "только язык / без вступительного экзамена";
  if (match.selection === "EVALUATION") return "оценка / проверочный тест";
  if (match.selection === "ENTRANCE_EXAM") return "вступительный экзамен";
  return "тип отбора неизвестен";
}

function seatsLabel(match: CuratorMatchView) {
  let label = "Квота уточняется";
  if (match.seatsUnlimited) label = "без лимита мест";
  else if (match.quotaSeats != null) {
    const scopeLabel = match.quotaScope
      ? labelApplicantCategory(match.quotaScope)
      : null;
    label =
      scopeLabel && scopeLabel !== "Не указано"
        ? `${match.quotaSeats} мест · ${scopeLabel}`
        : `${match.quotaSeats} мест`;
  }
  return withIndicative(label, match);
}

function deadlineLabel(match: CuratorMatchView) {
  if (!match.deadline) return "Дедлайн уточняется";
  const date = new Date(match.deadline).toLocaleDateString("ru-RU");
  return withIndicative(date, match);
}

export function CuratorProgramMatchCard({ match }: { match: CuratorMatchView }) {
  const langLine =
    match.languageRequirement ||
    (match.teachingLanguages.length
      ? match.teachingLanguages.join(", ")
      : match.language) ||
    "Не указано";

  return (
    <article className="flex flex-col overflow-hidden surface-card">
      <div className="flex items-start gap-3.5 border-b border-border px-5 py-4">
        <UniversityMonogram name={match.universityName} size="sm" />
        <div className="min-w-0 flex-1">
          <h3 className="text-[17px] font-semibold leading-snug tracking-tight text-foreground">
            {match.universityName}
          </h3>
          <p className="mt-0.5 text-[13px] font-medium">{match.programName}</p>
          <p className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            {match.city ? (
              <span className="inline-flex items-center gap-1">
                <MapPin className="h-3 w-3" />
                {match.city}
                {match.region ? ` · ${match.region}` : ""}
              </span>
            ) : (
              <span>Город не указан</span>
            )}
            <span>{labelOf(match.degreeLevel)}</span>
            <span>· {match.academicYear}</span>
          </p>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            <Badge variant="muted">
              {match.publicPrivate === "PRIVATE"
                ? "Частный"
                : match.publicPrivate === "PUBLIC"
                  ? "Государственный"
                  : "Тип вуза не указан"}
            </Badge>
            <Badge variant="muted">{accessLabel(match)}</Badge>
          </div>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          <span className="surface-chip rounded-full px-2.5 py-1 text-[12px] font-semibold tabular-nums text-[var(--brand)]">
            Совпадение {match.fitScore}/100
          </span>
          <span
            className={cn(
              "rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
              statusColor(match.eligibilityStatus)
            )}
          >
            {labelOf(match.eligibilityStatus)}
          </span>
          <Badge variant="muted">
            Данные: {labelOf(match.dataConfidence, {
              HIGH: "высокая уверенность",
              MEDIUM: "средняя уверенность",
              LOW: "низкая уверенность",
              UNKNOWN: "неизвестно",
            })}
          </Badge>
        </div>
      </div>

      <div className="flex flex-1 flex-col gap-3 px-4 py-3.5 text-sm">
        {match.whyIncluded ? (
          <p className="surface-well rounded-xl px-3 py-2 text-[13px] text-muted-foreground">
            {match.inclusionKind ? (
              <span className="mr-1 font-semibold uppercase tracking-wide opacity-80">
                {match.inclusionKind}
              </span>
            ) : null}
            {match.whyIncluded}
          </p>
        ) : null}
        <dl className="grid grid-cols-1 gap-2 text-xs sm:grid-cols-2">
          <div>
            <dt className="text-muted-foreground">Язык — требование</dt>
            <dd className="font-medium">{langLine}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Стоимость</dt>
            <dd className="font-medium">{tuitionLabel(match)}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Доступ</dt>
            <dd className="font-medium">{accessLabel(match)}</dd>
            <dd className="mt-0.5 text-muted-foreground">{selectionLabel(match)}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Места</dt>
            <dd className="font-medium">{seatsLabel(match)}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Дедлайн</dt>
            <dd className="font-medium">{deadlineLabel(match)}</dd>
          </div>
          <div className="sm:col-span-2">
            <dt className="text-muted-foreground">Экзамены</dt>
            <dd className="font-medium">
              {match.examsDisplay ||
                (match.selection === "NONE" ? "не требуются" : "Не указано")}
            </dd>
            {match.exams.some((e) => e.examinerUrl) ? (
              <ul className="mt-1 space-y-0.5">
                {match.exams
                  .filter((e) => e.examinerUrl)
                  .map((e) => (
                    <li key={`${e.label}-${e.examinerUrl}`}>
                      <a
                        href={e.examinerUrl!}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 text-[var(--brand)] hover:underline"
                      >
                        <ExternalLink className="h-3 w-3" />
                        {e.examinerLabel || e.label}
                      </a>
                    </li>
                  ))}
              </ul>
            ) : null}
          </div>
          {match.careerOutcomes ? (
            <div className="sm:col-span-2">
              <dt className="text-muted-foreground">Трудоустройство</dt>
              <dd className="font-medium">{match.careerOutcomes}</dd>
            </div>
          ) : null}
          <div className="sm:col-span-2">
            <dt className="text-muted-foreground">Актуальность набора</dt>
            <dd className="font-medium">{callLabel(match)}</dd>
            {match.admissionCallUrl ? (
              <a
                href={match.admissionCallUrl}
                target="_blank"
                rel="noreferrer"
                className="mt-0.5 inline-flex items-center gap-1 text-[var(--brand)] hover:underline"
              >
                <ExternalLink className="h-3 w-3" />
                Официальный набор
              </a>
            ) : null}
            {match.extractQuality &&
            (match.extractQuality === "LOW_EXTRACTION_QUALITY" ||
              match.extractQuality === "NEEDS_REVIEW" ||
              match.extractQuality === "MANUAL_REVIEW_REQUIRED") ? (
              <Badge variant="muted" className="mt-1">
                Качество извлечения: нужна проверка куратора
              </Badge>
            ) : null}
          </div>
        </dl>

        <details className="rounded-2xl border border-[var(--border)] bg-muted/30 px-3 py-2 text-xs">
          <summary className="cursor-pointer font-medium text-muted-foreground">
            Подтвердить досье (куратор)
          </summary>
          <form action={verifyProgramDossierFactsAction} className="mt-2 grid gap-2 sm:grid-cols-2">
            <input type="hidden" name="studentId" value={match.studentId} />
            <input
              type="hidden"
              name="programAcademicYearId"
              value={match.programAcademicYearId}
            />
            <label className="grid gap-0.5 sm:col-span-2">
              <span className="text-muted-foreground">Категория абитуриента</span>
              <select
                name="applicantCategory"
                defaultValue={match.applicantCategory || "UNKNOWN"}
                required
                className="rounded-xl border border-[var(--border)] bg-white px-2 py-1"
              >
                <option value="UNKNOWN" disabled>
                  Выберите категорию
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
            </label>
            <label className="grid gap-0.5">
              <span className="text-muted-foreground">Дедлайн</span>
              <input
                name="deadline"
                type="date"
                defaultValue={
                  match.deadline
                    ? new Date(match.deadline).toISOString().slice(0, 10)
                    : ""
                }
                className="rounded-xl border border-[var(--border)] bg-white px-2 py-1"
              />
            </label>
            <label className="grid gap-0.5">
              <span className="text-muted-foreground">Стоимость мин (€, необяз.)</span>
              <input
                name="tuitionMin"
                type="number"
                defaultValue={match.tuitionMin ?? ""}
                className="rounded-xl border border-[var(--border)] bg-white px-2 py-1"
              />
            </label>
            <label className="grid gap-0.5">
              <span className="text-muted-foreground">Стоимость макс (€, необяз.)</span>
              <input
                name="tuitionMax"
                type="number"
                defaultValue={match.tuitionMax ?? match.tuitionFixed ?? ""}
                className="rounded-xl border border-[var(--border)] bg-white px-2 py-1"
              />
            </label>
            <label className="grid gap-0.5">
              <span className="text-muted-foreground">Доступ</span>
              <select
                name="accessMode"
                defaultValue={match.accessMode || "UNKNOWN"}
                className="rounded-xl border border-[var(--border)] bg-white px-2 py-1"
              >
                <option value="UNKNOWN">Не указано</option>
                <option value="OPEN">Свободный доступ</option>
                <option value="CLOSED">Конкурс</option>
              </select>
            </label>
            <label className="grid gap-0.5">
              <span className="text-muted-foreground">
                Места для выбранной категории
              </span>
              <input
                name="nonEuSeats"
                type="number"
                defaultValue={match.nonEuSeats ?? ""}
                className="rounded-xl border border-[var(--border)] bg-white px-2 py-1"
              />
            </label>
            <label className="grid gap-0.5 sm:col-span-2">
              <span className="text-muted-foreground">Экзамены</span>
              <input
                name="examsDisplay"
                type="text"
                defaultValue={match.examsDisplay ?? ""}
                placeholder="SAT ≥ 1200 или TOLC-E"
                className="rounded-xl border border-[var(--border)] bg-white px-2 py-1"
              />
            </label>
            <label className="grid gap-0.5 sm:col-span-2">
              <span className="text-muted-foreground">
                Ссылка на официальный источник
              </span>
              <input
                name="manualSourceUrl"
                type="url"
                required
                className="rounded-xl border border-[var(--border)] bg-white px-2 py-1"
              />
            </label>
            <label className="grid gap-0.5 sm:col-span-2">
              <span className="text-muted-foreground">Точная цитата</span>
              <textarea
                name="evidenceQuote"
                required
                className="rounded-xl border border-[var(--border)] bg-white px-2 py-1"
              />
            </label>
            <Button type="submit" size="sm" className="sm:col-span-2">
              Сохранить подтверждение
            </Button>
          </form>
        </details>

        {match.reasons.length > 0 ? (
          <div>
            <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              Почему подходит
            </p>
            <ul className="mt-1 space-y-1 text-xs">
              {match.reasons.map((r) => (
                <li key={r}>✓ {r}</li>
              ))}
            </ul>
          </div>
        ) : null}

        {(match.risks.length > 0 || match.riskNotes.length > 0) && (
          <div>
            <p className="text-[11px] font-medium uppercase tracking-wide text-amber-800">
              Риски
            </p>
            <ul className="mt-1 space-y-1 text-xs text-amber-900">
              {match.riskNotes.map((n) => (
                <li key={n}>⚠ {n}</li>
              ))}
              {match.risks.map((r) => (
                <li key={r}>⚠ {r}</li>
              ))}
            </ul>
          </div>
        )}

        {match.sourceUrls.length > 0 ? (
          <div className="flex flex-wrap gap-2">
            {match.sourceUrls.slice(0, 4).map((url) => (
              <a
                key={url}
                href={url}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 text-xs text-[var(--brand)] hover:underline"
              >
                <ExternalLink className="h-3 w-3" />
                Источник
              </a>
            ))}
          </div>
        ) : null}

        <div className="mt-auto grid grid-cols-2 gap-2 pt-1">
          <form action={reviewProgramMatchAction}>
            <input type="hidden" name="studentId" value={match.studentId} />
            <input type="hidden" name="matchId" value={match.matchId} />
            <input type="hidden" name="status" value="APPROVED" />
            <Button type="submit" size="sm" variant="outline" className="w-full">
              Одобрить
            </Button>
          </form>
          <form action={reviewProgramMatchAction}>
            <input type="hidden" name="studentId" value={match.studentId} />
            <input type="hidden" name="matchId" value={match.matchId} />
            <input type="hidden" name="status" value="REJECTED" />
            <Button type="submit" size="sm" variant="outline" className="w-full">
              Отклонить
            </Button>
          </form>
          <form action={reviewProgramMatchAction}>
            <input type="hidden" name="studentId" value={match.studentId} />
            <input type="hidden" name="matchId" value={match.matchId} />
            <input type="hidden" name="status" value="NEEDS_REVIEW" />
            <Button type="submit" size="sm" variant="outline" className="w-full">
              На проверку
            </Button>
          </form>
          <form action={reviewProgramMatchAction}>
            <input type="hidden" name="studentId" value={match.studentId} />
            <input type="hidden" name="matchId" value={match.matchId} />
            <input type="hidden" name="status" value="SHORTLISTED" />
            <Button type="submit" size="sm" className="w-full">
              В короткий список
            </Button>
          </form>
        </div>

        {match.alreadyApplied && match.applicationId ? (
          <Button asChild size="sm" variant="outline" className="w-full">
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
            <input
              type="hidden"
              name="programAcademicYearId"
              value={match.programAcademicYearId}
            />
            <input type="hidden" name="intake" value={match.intake} />
            <Button type="submit" size="sm" variant="secondary" className="w-full">
              Создать заявку
            </Button>
          </form>
        )}
      </div>
    </article>
  );
}
