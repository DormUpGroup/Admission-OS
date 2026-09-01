import { daysUntil } from "@/lib/utils";
import {
  formatAcademicYearShort,
  humanizeLanguage,
  humanizeWhyFits,
  previousYearCallNote,
  ruCount,
} from "./humanize";
import type {
  JourneyNowTask,
  JourneyPrimaryCta,
  JourneyProgramPreview,
  JourneyStageId,
  JourneyStageStatus,
  JourneyStageView,
  ProgramPreviewStatus,
  StudentJourneyApplicationInput,
  StudentJourneyDocumentInput,
  StudentJourneyInput,
  StudentJourneyProgramInput,
  StudentJourneyView,
} from "./types";

const STAGE_LABELS: Record<JourneyStageId, string> = {
  PROGRAMS: "Программы",
  REQUIREMENTS: "Требования",
  DOCUMENTS: "Документы",
  SUBMISSION: "Подача",
};

const STAGE_STATUS_LABELS: Record<JourneyStageStatus, string> = {
  CURRENT: "Текущий этап",
  DONE: "Готово",
  NEXT: "Далее",
  WAITING_CURATOR: "Ожидает куратора",
  UNAVAILABLE: "Недоступно пока",
};

const PROGRAM_STATUS_LABELS: Record<ProgramPreviewStatus, string> = {
  NEEDS_CHOICE: "нужно выбрать",
  SELECTED: "выбрано",
  CURATOR_REVIEWING: "куратор проверяет",
};

const PRIMARY_CTA: Record<JourneyStageId, JourneyPrimaryCta> = {
  PROGRAMS: { label: "Посмотреть программы", href: "/portal/programs" },
  REQUIREMENTS: { label: "Посмотреть требования", href: "/portal/applications" },
  DOCUMENTS: { label: "Загрузить документы", href: "/portal/documents" },
  SUBMISSION: { label: "Посмотреть заявки", href: "/portal/applications" },
};

const SUBMITTED_STATUSES = new Set([
  "SUBMITTED",
  "WAITING_RESULT",
  "ADMITTED",
  "REJECTED",
  "WAITLISTED",
  "ENROLLED",
]);

const STUDENT_UPLOAD_STATUSES = new Set(["REQUESTED", "NEEDS_CHANGES"]);
const REVIEW_STATUSES = new Set(["UPLOADED", "UNDER_REVIEW"]);
const APPROVED_STATUSES = new Set(["APPROVED"]);

function needsStudentUpload(doc: StudentJourneyDocumentInput) {
  return STUDENT_UPLOAD_STATUSES.has(doc.status) || doc.status === "MISSING";
}

const NOW_EMPTY =
  "Сейчас ничего делать не нужно. Мы сообщим, когда появится следующий шаг.";

const CURATOR_EMPTY = "Мы назначим куратора после обработки анкеты";

const STAGE_ORDER: JourneyStageId[] = [
  "PROGRAMS",
  "REQUIREMENTS",
  "DOCUMENTS",
  "SUBMISSION",
];

function uniquePrograms(programs: StudentJourneyProgramInput[]) {
  const byId = new Map<string, StudentJourneyProgramInput>();
  const rank = { application: 0, shortlist: 1, match: 2 };
  for (const program of programs) {
    if (program.rejected) continue;
    const existing = byId.get(program.programId);
    if (!existing || rank[program.source] < rank[existing.source]) {
      byId.set(program.programId, {
        ...program,
        hasApplication: program.hasApplication || Boolean(existing?.hasApplication),
        reasons:
          program.reasons.length > 0 ? program.reasons : existing?.reasons ?? [],
        curatorNote: program.curatorNote ?? existing?.curatorNote ?? null,
        verifiedAt: program.verifiedAt ?? existing?.verifiedAt ?? null,
      });
    } else if (existing) {
      existing.hasApplication = existing.hasApplication || program.hasApplication;
      if (existing.reasons.length === 0 && program.reasons.length > 0) {
        existing.reasons = program.reasons;
      }
      if (!existing.curatorNote && program.curatorNote) {
        existing.curatorNote = program.curatorNote;
      }
      if (!existing.verifiedAt && program.verifiedAt) {
        existing.verifiedAt = program.verifiedAt;
      }
    }
  }
  return [...byId.values()];
}

function hasSelectedPrograms(programs: StudentJourneyProgramInput[]) {
  return programs.some(
    (p) => !p.rejected && (p.source === "shortlist" || p.hasApplication)
  );
}

function hasConfirmedRequirements(
  programs: StudentJourneyProgramInput[],
  applications: StudentJourneyApplicationInput[]
) {
  if (applications.some((a) => a.requirementCount > 0)) return true;
  const selectedIds = new Set(
    programs
      .filter((p) => !p.rejected && (p.source === "shortlist" || p.hasApplication))
      .map((p) => p.programId)
  );
  return programs.some(
    (p) => selectedIds.has(p.programId) && p.verifiedAt != null
  );
}

function documentsStarted(documents: StudentJourneyDocumentInput[]) {
  return documents.length > 0;
}

function documentsComplete(documents: StudentJourneyDocumentInput[]) {
  return (
    documents.length > 0 &&
    documents.every((d) => APPROVED_STATUSES.has(d.status))
  );
}

function determineCurrentStage(input: StudentJourneyInput): {
  stage: JourneyStageId;
  waitingCurator: boolean;
} {
  const selected = hasSelectedPrograms(input.programs);
  const confirmed = hasConfirmedRequirements(input.programs, input.applications);
  const docsStarted = documentsStarted(input.documents);
  const docsDone = documentsComplete(input.documents);
  const submitted = input.applications.some((a) =>
    SUBMITTED_STATUSES.has(a.status)
  );
  const submissionPrep = input.applications.some((a) =>
    ["READY_TO_SUBMIT", "READY_FOR_REVIEW", "PREPARING"].includes(a.status)
  );

  if (submitted || (docsDone && input.applications.length > 0)) {
    return { stage: "SUBMISSION", waitingCurator: !submitted && !submissionPrep };
  }

  if (docsStarted) {
    const studentMustAct = input.documents.some(needsStudentUpload);
    const onlyWaitingReview =
      !studentMustAct &&
      input.documents.some((d) => REVIEW_STATUSES.has(d.status));
    return {
      stage: "DOCUMENTS",
      waitingCurator: onlyWaitingReview || !studentMustAct,
    };
  }

  if (selected) {
    if (confirmed) {
      return { stage: "DOCUMENTS", waitingCurator: true };
    }
    return { stage: "REQUIREMENTS", waitingCurator: true };
  }

  return {
    stage: "PROGRAMS",
    waitingCurator: input.hasMatchingProfile,
  };
}

function buildStageViews(
  current: JourneyStageId,
  waitingCurator: boolean
): JourneyStageView[] {
  const currentIdx = STAGE_ORDER.indexOf(current);
  return STAGE_ORDER.map((id, idx) => {
    let status: JourneyStageStatus;
    if (idx < currentIdx) status = "DONE";
    else if (idx === currentIdx) {
      status = waitingCurator ? "WAITING_CURATOR" : "CURRENT";
    } else if (idx === currentIdx + 1) status = "NEXT";
    else status = "UNAVAILABLE";

    return {
      id,
      label: STAGE_LABELS[id],
      status,
      statusLabel: STAGE_STATUS_LABELS[status],
    };
  });
}

function buildHeadline(input: StudentJourneyInput, current: JourneyStageId) {
  const year = formatAcademicYearShort(input.intake);
  const yearBit = year ? ` в ${year}` : "";

  if (current === "PROGRAMS") {
    if (!input.hasMatchingProfile) {
      return "Сначала заполните анкету — так мы подберём программы";
    }
    if (input.programs.some((p) => !p.rejected && p.source === "shortlist")) {
      return `Сейчас выбираем программы для поступления${yearBit}`;
    }
    if (input.programs.some((p) => !p.rejected && p.source === "match")) {
      return `Куратор готовит программы для поступления${yearBit}`;
    }
    return `Куратор готовит следующий шаг`;
  }

  if (current === "REQUIREMENTS") {
    return "Куратор проверяет требования выбранных программ";
  }

  if (current === "DOCUMENTS") {
    const toUpload = input.documents.filter(needsStudentUpload).length;
    if (toUpload > 0) {
      return `Осталось загрузить ${ruCount(toUpload, "документ", "документа", "документов")}`;
    }
    const reviewing = input.documents.filter((d) =>
      REVIEW_STATUSES.has(d.status)
    ).length;
    if (reviewing > 0) {
      return "Куратор проверяет загруженные документы";
    }
    if (input.documents.length === 0) {
      return "Куратор готовит список документов";
    }
    return "Документы в работе";
  }

  const submittedCount = input.applications.filter((a) =>
    SUBMITTED_STATUSES.has(a.status)
  ).length;
  if (submittedCount > 0) {
    return submittedCount === 1
      ? "Заявка отправлена — можно следить за статусом"
      : `Отправлено ${ruCount(submittedCount, "заявка", "заявки", "заявок")}`;
  }
  return "Готовим заявки к подаче";
}

function deadlineHref(applicationId: string | null) {
  return applicationId
    ? `/portal/applications/${applicationId}`
    : "/portal/applications";
}

function documentHref() {
  return "/portal/documents";
}

function buildNowTasks(input: StudentJourneyInput, now: Date): JourneyNowTask[] {
  const candidates: Array<JourneyNowTask & { rank: number; dueTs: number }> =
    [];
  const seenDocs = new Set<string>();

  if (!input.hasQuestionnaire) {
    candidates.push({
      id: "questionnaire-1",
      title: "Заполните анкету",
      reason: "Без неё мы не сможем начать подбор программ",
      dueDate: null,
      dueDateOverdue: false,
      actionLabel: "Открыть анкету",
      actionHref: "/portal/questionnaire",
      kind: "STUDENT_ACTION",
      rank: 2,
      dueTs: Number.POSITIVE_INFINITY,
    });
  } else if (!input.hasMatchingProfile) {
    candidates.push({
      id: "questionnaire-2",
      title: "Заполните анкету по программам",
      reason: "Нужны уровень, язык и направления, чтобы подобрать вузы",
      dueDate: null,
      dueDateOverdue: false,
      actionLabel: "Открыть анкету",
      actionHref: "/portal/questionnaire-2",
      kind: "STUDENT_ACTION",
      rank: 2,
      dueTs: Number.POSITIVE_INFINITY,
    });
  }

  const publicDeadlines = input.deadlines.filter((d) => !d.isInternal);
  const deadlineKeys = new Set(
    publicDeadlines.map((d) => `${d.title}|${d.date.toISOString()}`)
  );
  const deadlineAppDays = new Set(
    publicDeadlines
      .filter((d) => d.applicationId)
      .map(
        (d) => `${d.applicationId}|${d.date.toISOString().slice(0, 10)}`
      )
  );

  for (const dl of publicDeadlines) {
    const overdue = daysUntil(dl.date, now) < 0;
    candidates.push({
      id: `deadline-${dl.id}`,
      title: dl.title,
      reason: overdue
        ? "Подтверждённый срок уже прошёл"
        : "Ближайший подтверждённый срок",
      dueDate: dl.date.toISOString(),
      dueDateOverdue: overdue,
      actionLabel: "Открыть",
      actionHref: deadlineHref(dl.applicationId),
      kind: "DEADLINE",
      rank: 1,
      dueTs: dl.date.getTime(),
    });
  }

  for (const app of input.applications) {
    if (!app.hardDeadline) continue;
    const key = `Подача|${app.hardDeadline.toISOString()}`;
    const appDay = `${app.id}|${app.hardDeadline.toISOString().slice(0, 10)}`;
    if (deadlineKeys.has(key) || deadlineAppDays.has(appDay)) continue;
    const overdue = daysUntil(app.hardDeadline, now) < 0;
    candidates.push({
      id: `app-deadline-${app.id}`,
      title: "Срок подачи",
      reason: overdue
        ? "Подтверждённый срок уже прошёл"
        : "Ближайший подтверждённый срок подачи",
      dueDate: app.hardDeadline.toISOString(),
      dueDateOverdue: overdue,
      actionLabel: "Открыть заявку",
      actionHref: `/portal/applications/${app.id}`,
      kind: "DEADLINE",
      rank: 1,
      dueTs: app.hardDeadline.getTime(),
    });
  }

  for (const doc of input.documents) {
    if (doc.status === "NEEDS_CHANGES") {
      seenDocs.add(doc.id);
      candidates.push({
        id: `doc-${doc.id}`,
        title: `Обновите «${doc.name}»`,
        reason: doc.studentFeedback?.trim()
          ? doc.studentFeedback.trim()
          : "Куратор просит внести правки",
        dueDate: null,
        dueDateOverdue: false,
        actionLabel: "Открыть документы",
        actionHref: documentHref(),
        kind: "STUDENT_ACTION",
        rank: 2,
        dueTs: Number.POSITIVE_INFINITY,
      });
    } else if (
      doc.status === "REQUESTED" ||
      doc.status === "MISSING"
    ) {
      seenDocs.add(doc.id);
      candidates.push({
        id: `doc-${doc.id}`,
        title: `Загрузите «${doc.name}»`,
        reason: "Куратор запросил этот документ",
        dueDate: null,
        dueDateOverdue: false,
        actionLabel: "Загрузить",
        actionHref: documentHref(),
        kind: "CURATOR_REQUEST",
        rank: 3,
        dueTs: Number.POSITIVE_INFINITY,
      });
    }
  }

  for (const task of input.tasks) {
    if (task.documentId && seenDocs.has(task.documentId)) continue;
    candidates.push({
      id: `task-${task.id}`,
      title: task.title,
      reason: task.description?.trim() || "Нужно ваше действие",
      dueDate: task.dueDate ? task.dueDate.toISOString() : null,
      dueDateOverdue: Boolean(
        task.dueDate && daysUntil(task.dueDate, now) < 0
      ),
      actionLabel: "Открыть",
      actionHref: task.applicationId
        ? `/portal/applications/${task.applicationId}`
        : task.documentId
          ? documentHref()
          : "/portal/tasks",
      kind: task.dueDate ? "DEADLINE" : "STUDENT_ACTION",
      rank: task.dueDate ? 1 : 2,
      dueTs: task.dueDate ? task.dueDate.getTime() : Number.POSITIVE_INFINITY,
    });
  }

  candidates.sort((a, b) => a.rank - b.rank || a.dueTs - b.dueTs);
  return candidates.slice(0, 3).map((task) => ({
    id: task.id,
    title: task.title,
    reason: task.reason,
    dueDate: task.dueDate,
    dueDateOverdue: task.dueDateOverdue,
    actionLabel: task.actionLabel,
    actionHref: task.actionHref,
    kind: task.kind,
  }));
}

function previewStatus(program: StudentJourneyProgramInput): ProgramPreviewStatus {
  if (program.hasApplication) return "SELECTED";
  if (program.source === "shortlist") return "NEEDS_CHOICE";
  return "CURATOR_REVIEWING";
}

function buildProgramPreviews(
  programs: StudentJourneyProgramInput[],
  intake: string | null
): JourneyProgramPreview[] {
  const unique = uniquePrograms(programs);
  const selected = unique.filter((p) => p.hasApplication);
  const shortlist = unique.filter(
    (p) => p.source === "shortlist" && !p.hasApplication
  );
  const ordered = [...selected, ...shortlist].slice(0, 3);

  return ordered.map((program) => {
    const status = previewStatus(program);
    const sourceYear = program.indicativeFromYear || program.academicYear;
    return {
      programId: program.programId,
      universityName: program.universityName,
      programName: program.programName,
      city: program.city,
      language: humanizeLanguage(program.language),
      whyFits: humanizeWhyFits(program.reasons, program.curatorNote),
      status,
      statusLabel: PROGRAM_STATUS_LABELS[status],
      previousYearNote: previousYearCallNote(
        sourceYear,
        intake,
        program.indicativeFromYear
      ),
    };
  });
}

function buildProgramsBlock(input: StudentJourneyInput) {
  const unique = uniquePrograms(input.programs);
  const selected = unique.filter(
    (p) => p.hasApplication || p.source === "shortlist"
  );
  const considering = unique.filter(
    (p) => !p.hasApplication && p.source !== "shortlist"
  );

  const selectedCount = selected.length;
  const consideringCount =
    selectedCount > 0 ? considering.length : unique.filter((p) => !p.hasApplication).length;

  return {
    consideringCount,
    selectedCount,
    previews: buildProgramPreviews(input.programs, input.intake),
    allHref: "/portal/programs",
  };
}

function buildDocumentsBlock(input: StudentJourneyInput, current: JourneyStageId) {
  if (input.documents.length === 0) return null;
  if (current !== "DOCUMENTS" && current !== "SUBMISSION") return null;

  return {
    approvedCount: input.documents.filter((d) => APPROVED_STATUSES.has(d.status))
      .length,
    totalCount: input.documents.length,
    awaitingReviewCount: input.documents.filter((d) =>
      REVIEW_STATUSES.has(d.status)
    ).length,
    href: "/portal/documents",
  };
}

export function buildStudentJourneyView(
  input: StudentJourneyInput
): StudentJourneyView {
  const now = input.now ?? new Date();
  const { stage, waitingCurator } = determineCurrentStage(input);
  const nowTasks = buildNowTasks(input, now);

  return {
    currentStage: stage,
    headline: buildHeadline(input, stage),
    primaryCta: PRIMARY_CTA[stage],
    stages: buildStageViews(stage, waitingCurator),
    nowTasks,
    nowEmptyMessage: nowTasks.length === 0 ? NOW_EMPTY : null,
    programs: buildProgramsBlock(input),
    documents: buildDocumentsBlock(input, stage),
    curator: input.curator
      ? {
          assigned: true,
          name: input.curator.name,
          responseHint: null,
          emptyMessage: null,
          writeHref: "/portal/messages",
        }
      : {
          assigned: false,
          name: null,
          responseHint: null,
          emptyMessage: CURATOR_EMPTY,
          writeHref: "/portal/messages",
        },
  };
}
