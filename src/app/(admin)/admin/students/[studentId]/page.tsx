import Link from "next/link";
import { notFound } from "next/navigation";
import {
  requireStaff,
  assertStudentAccess,
} from "@/server/auth/guards";
import { prisma } from "@/lib/db";
import { fullName, formatDate, cn } from "@/lib/utils";
import { parseNextAction, criticalIncomplete } from "@/server/services/readiness";
import { activityLabel } from "@/server/services/activity";
import {
  createTaskAction,
  createDocumentAction,
  createApplicationAction,
  requestDocumentAction,
  approveDocumentAction,
  needsChangesAction,
  addManualProgramMatchAction,
} from "@/server/actions";
import { PageHeader } from "@/components/page-header";
import { RiskBadge } from "@/components/risk-badge";
import { StatusBadge } from "@/components/status-badge";
import { ApplicationCard } from "@/components/application-card";
import { ActivityTimeline } from "@/components/activity-timeline";
import { InAppNotificationsPanel } from "@/components/in-app-notifications";
import { TaskList } from "@/components/task-list";
import { DeadlineList } from "@/components/deadline-list";
import { StudentAvatar } from "@/components/student-avatar";
import { DocumentStatusBadge } from "@/components/document-status-badge";
import { EmptyState } from "@/components/empty-state";
import { GenerateProgramMatchesButton } from "@/components/generate-program-matches-button";
import { ResetProgramMatchesButton } from "@/components/reset-program-matches-button";
import { ResetUniversitalyCacheButton } from "@/components/reset-universitaly-cache-button";
import type { CuratorMatchView } from "@/components/curator-program-match-card";
import { CuratorProgramLevelsCard } from "@/components/admin/curator-program-levels";
import { StudentAdminSummary } from "@/components/admin/student-admin-summary";
import { ShowAllMatches } from "@/components/admin/show-all-matches";
import { buildWorkQueue } from "@/server/services/work-queue/build-work-queue";
import { inferUnknownReason } from "@/server/services/work-queue/field-reasons";
import { curatorStageForStudent } from "@/server/services/work-queue/stage";
import type { WorkQueueStudentInput } from "@/server/services/work-queue/types";
import {
  applyCuratorMatchFilters,
  mergeDossierIntoCuratorView,
} from "@/server/services/program-matching/curator-match-filters";
import { getProgramDossier } from "@/server/services/program-matching/program-dossier";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { JourneyStage } from "@/lib/enums";
import type { ActivityType } from "@/lib/enums";
import { JOURNEY_LABELS, labelApplicantCategory, labelOf } from "@/lib/labels";
import {
  hasQuestionnaire,
  hasMatchingProfile,
  parsePreferredCities,
} from "@/server/services/program-match";
import { buildMatchingProfile } from "@/server/services/program-matching/program-matching";
import { listPersistedMatches } from "@/server/services/program-matching/program-matching";
import { listStudentShortlist } from "@/server/services/program-matching/shortlist";
import {
  PERSONAL_QUESTIONNAIRE_SECTIONS,
  parsePersonalAnswers,
} from "@/lib/questionnaire-personal";
import {
  PROGRAMS_QUESTIONNAIRE_SECTIONS,
  parseProgramsAnswers,
} from "@/lib/questionnaire-programs";

const TABS = [
  { id: "overview", label: "Обзор" },
  { id: "programs", label: "Программы" },
  { id: "documents", label: "Документы" },
  { id: "applications", label: "Заявки" },
  { id: "history", label: "История" },
] as const;

const STAGES = Object.values(JourneyStage);

export default async function StudentProfilePage({
  params,
  searchParams,
}: {
  params: Promise<{ studentId: string }>;
  searchParams: Promise<{
    tab?: string;
    focus?: string;
    eligibility?: string;
    confidence?: string;
    curator?: string;
    city?: string;
    language?: string;
    publicPrivate?: string;
    accessMode?: string;
    hasExam?: string;
    tuitionMax?: string;
    callFreshness?: string;
    deadlineBefore?: string;
  }>;
}) {
  await requireStaff();
  const { studentId } = await params;
  const sp = await searchParams;
  const requestedTab =
    sp.tab === "match"
      ? "programs"
      : sp.tab === "timeline"
        ? "history"
        : sp.tab === "tasks"
          ? "overview"
          : sp.tab;
  const tab = TABS.some((t) => t.id === requestedTab) ? requestedTab! : "overview";
  const focusPayId = sp.focus ?? "";

  await assertStudentAccess(studentId);

  const student = await prisma.student.findUnique({
    where: { id: studentId },
    include: {
      curator: true,
      applications: {
        include: {
          program: { include: { university: true } },
          requirements: true,
        },
        orderBy: { updatedAt: "desc" },
      },
      documents: { orderBy: [{ category: "asc" }, { name: "asc" }] },
      tasks: {
        where: { status: { not: "DONE" } },
        orderBy: [{ dueDate: "asc" }, { createdAt: "desc" }],
      },
      deadlines: {
        where: { date: { gte: new Date(Date.now() - 86400000) } },
        orderBy: { date: "asc" },
        take: 10,
      },
      activities: {
        include: { user: true },
        orderBy: { createdAt: "desc" },
        take: 40,
      },
    },
  });

  if (!student) notFound();

  const [programs, templates, persistedMatches, shortlist, matchingProfile, curatorNotifications] =
    await Promise.all([
      prisma.program.findMany({
        include: { university: true },
        orderBy: [{ university: { name: "asc" } }, { name: "asc" }],
      }),
      prisma.applicationTemplate.findMany({ orderBy: { name: "asc" } }),
      listPersistedMatches(studentId),
      listStudentShortlist(studentId),
      buildMatchingProfile(studentId),
      student.curatorId
        ? prisma.inAppNotification.findMany({
            where: { userId: student.curatorId, studentId },
            orderBy: { createdAt: "desc" },
            take: 20,
          })
        : Promise.resolve([]),
    ]);

  const preferredCities = parsePreferredCities(student.preferredCities);
  const questionnaireDone = hasQuestionnaire(student);
  const matchingReady = hasMatchingProfile(student);
  const personalAnswers = parsePersonalAnswers(student.questionnairePersonalJson);
  const programsAnswers = parseProgramsAnswers(student.questionnaireProgramsJson);

  const dossiers = await Promise.all(
    persistedMatches.map((m) =>
      getProgramDossier(m.programAcademicYearId, {
        applicantCategory: matchingProfile?.applicantCategory,
      })
    )
  );
  const dossierByPay = new Map(
    dossiers
      .filter(Boolean)
      .map((d) => [d!.programAcademicYearId, d!] as const)
  );

  const curatorViewsRaw: CuratorMatchView[] = persistedMatches.map((m) => {
    const pay = m.programAcademicYear;
    const program = pay.program;
    let reasons: string[] = [];
    let risks: string[] = [];
    let riskNotes: string[] = [];
    let missingInformation: string[] = [];
    let requirements: Array<{ description: string; status: string }> = [];
    let scoreBreakdown: Record<string, number> | null = null;
    try {
      reasons = m.reasonsJson ? JSON.parse(m.reasonsJson) : [];
    } catch {
      reasons = [];
    }
    try {
      const r = m.risksJson ? JSON.parse(m.risksJson) : {};
      risks = r.flags || [];
      riskNotes = r.notes || [];
    } catch {
      risks = [];
    }
    try {
      missingInformation = m.missingInformationJson
        ? JSON.parse(m.missingInformationJson)
        : [];
    } catch {
      missingInformation = [];
    }
    try {
      requirements = m.requirementsSummaryJson
        ? JSON.parse(m.requirementsSummaryJson)
        : [];
    } catch {
      requirements = [];
    }
    try {
      scoreBreakdown = m.scoreBreakdownJson
        ? JSON.parse(m.scoreBreakdownJson)
        : null;
    } catch {
      scoreBreakdown = null;
    }
    let whyIncluded: string | null = null;
    let inclusionKind: string | null = null;
    try {
      const meta = m.discoveryMetaJson
        ? (JSON.parse(m.discoveryMetaJson) as {
            whyIncluded?: string;
            inclusion?: { kind?: string };
          })
        : null;
      whyIncluded = meta?.whyIncluded ?? null;
      inclusionKind = meta?.inclusion?.kind ?? null;
    } catch {
      whyIncluded = null;
      inclusionKind = null;
    }
    const app = student.applications.find((a) => a.programId === program.id);
    const teachingLanguages = (() => {
      try {
        const v = program.teachingLanguagesJson
          ? JSON.parse(program.teachingLanguagesJson)
          : [];
        return Array.isArray(v) ? v.map(String) : [];
      } catch {
        return program.language ? [program.language] : [];
      }
    })();

    const base: CuratorMatchView = {
      matchId: m.id,
      programId: program.id,
      programAcademicYearId: pay.id,
      programName: program.name,
      universityName: program.university.name,
      city: null,
      universityCity: program.university.city,
      region: null,
      degreeLevel: program.degreeLevel,
      language: program.language,
      teachingLanguages,
      languageRequirement: null,
      publicPrivate: program.university.publicPrivate || "UNKNOWN",
      field: program.field,
      academicYear: pay.academicYear,
      applicantCategory: matchingProfile?.applicantCategory ?? "UNKNOWN",
      eligibilityStatus: m.eligibilityStatus,
      fitScore: m.fitScore,
      dataConfidence: m.dataConfidence,
      curatorStatus: m.curatorStatus,
      reasons,
      risks,
      riskNotes,
      missingInformation,
      requirements,
      deadline: null,
      tuitionMin: null,
      tuitionMax: null,
      tuitionFixed: null,
      accessMode: "UNKNOWN",
      selection: "UNKNOWN",
      euSeats: null,
      nonEuSeats: null,
      seatsUnlimited: false,
      exams: [],
      examsDisplay: null,
      careerOutcomes: null,
      callFreshness: pay.indicativeFromYear ? "indicative" : "unknown",
      indicativeFromYear: pay.indicativeFromYear,
      admissionCallUrl: null,
      extractQuality: null,
      sourceUrls: [
        ...new Set(
          [
            program.officialUrl,
            program.universitalyUrl,
            ...pay.facts.map((f) => f.sourceUrl).filter(Boolean),
          ].filter(Boolean) as string[]
        ),
      ],
      alreadyApplied: !!app,
      applicationId: app?.id,
      studentId,
      intake: student.intake,
      scoreBreakdown,
      whyIncluded,
      inclusionKind,
      monitoringSelected: m.monitoringSelected ?? false,
      campuses: [],
      criticalFacts: [],
      aiEnrichment: (() => {
        const run = (
          pay as typeof pay & {
            enrichmentRuns?: Array<{
              finishedAt: Date | null;
              model: string | null;
              status: string;
              sourceDocumentIdsJson: string | null;
              promptVersion: string;
            }>;
          }
        ).enrichmentRuns?.[0];
        if (!run) {
          return {
            date: null,
            model: null,
            reused: false,
            documentCount: 0,
            disabled: true,
          };
        }
        let docCount = 0;
        try {
          docCount = run.sourceDocumentIdsJson
            ? (JSON.parse(run.sourceDocumentIdsJson) as unknown[]).length
            : 0;
        } catch {
          docCount = 0;
        }
        return {
          date: run.finishedAt?.toISOString() ?? null,
          model: run.model,
          reused: run.status === "REUSED",
          documentCount: docCount,
          promptVersion: run.promptVersion,
          disabled: false,
        };
      })(),
    };

    return mergeDossierIntoCuratorView(
      base,
      dossierByPay.get(pay.id) ?? null
    );
  });

  const shortlistPayIds = new Set(
    shortlist.map((item) => item.programAcademicYearId)
  );
  const curatorViewsMarked = curatorViewsRaw.map((view) => ({
    ...view,
    onShortlist: shortlistPayIds.has(view.programAcademicYearId),
  }));

  const shortlistViews = curatorViewsMarked.filter((m) => m.onShortlist);
  const reviewViews = curatorViewsMarked.filter(
    (m) =>
      !m.onShortlist &&
      (m.curatorStatus === "NEEDS_REVIEW" ||
        m.eligibilityStatus === "NEEDS_REVIEW")
  );
  const otherMatchViews = applyCuratorMatchFilters(
    curatorViewsMarked.filter(
      (m) =>
        !m.onShortlist &&
        m.curatorStatus !== "NEEDS_REVIEW" &&
        m.eligibilityStatus !== "NEEDS_REVIEW"
    ),
    {
      eligibility: sp.eligibility,
      confidence: sp.confidence,
      curator: sp.curator,
      city: sp.city,
      language: sp.language,
      publicPrivate: sp.publicPrivate,
      accessMode: sp.accessMode,
      hasExam: sp.hasExam,
      callFreshness: sp.callFreshness,
    }
  );

  const messageNotes = student.activities
    .map((activity) => {
      if (activity.type !== "NOTE" || !activity.metadata) return null;
      try {
        const meta = JSON.parse(activity.metadata) as {
          channel?: string;
          from?: string;
          note?: string;
        };
        if (meta.channel !== "student-curator" || !meta.note?.trim()) return null;
        return { fromStudent: meta.from === "student", at: activity.createdAt };
      } catch {
        return null;
      }
    })
    .filter((item): item is { fromStudent: boolean; at: Date } => Boolean(item));
  const lastStudentMessage = [...messageNotes]
    .reverse()
    .find((m) => m.fromStudent);
  const lastCuratorReply = [...messageNotes]
    .reverse()
    .find((m) => !m.fromStudent);

  const queueStudent: WorkQueueStudentInput = {
    id: studentId,
    firstName: student.firstName,
    lastName: student.lastName,
    curatorId: student.curatorId,
    intake: student.intake,
    hasQuestionnaire: questionnaireDone,
    hasMatchingProfile: matchingReady,
    applications: student.applications.map((a) => ({
      id: a.id,
      programId: a.programId,
      status: a.status,
      hardDeadline: a.hardDeadline,
      requirementCount: a.requirements.length,
    })),
    documents: student.documents.map((d) => ({
      id: d.id,
      name: d.name,
      status: d.status,
      requestedAt: d.requestedAt,
    })),
    tasks: student.tasks.map((t) => ({
      id: t.id,
      title: t.title,
      status: t.status,
      dueDate: t.dueDate,
      isStudentFacing: t.isStudentFacing,
      documentId: t.documentId,
      applicationId: t.applicationId,
    })),
    deadlines: student.deadlines.map((d) => ({
      id: d.id,
      title: d.title,
      date: d.date,
      isHardDeadline: d.isHardDeadline,
      type: d.type,
      applicationId: d.applicationId,
    })),
    programs: persistedMatches.map((m) => {
      const pay = m.programAcademicYear;
      const dossier = dossierByPay.get(pay.id);
      const tuitionMissing =
        dossier?.tuitionMin == null &&
        dossier?.tuitionMax == null &&
        dossier?.tuitionFixed == null;
      const tuitionVerified =
        dossier?.criticalFacts.some(
          (fact) =>
            fact.field === "TUITION" &&
            fact.origin === "MANUAL_VERIFIED"
        ) ?? false;
      return {
        matchId: m.id,
        programId: pay.program.id,
        programAcademicYearId: pay.id,
        programName: pay.program.name,
        universityName: pay.program.university.name,
        curatorStatus: m.curatorStatus,
        eligibilityStatus: m.eligibilityStatus,
        inShortlist: shortlistPayIds.has(pay.id),
        hasApplication: student.applications.some(
          (a) => a.programId === pay.program.id
        ),
        academicYear: pay.academicYear,
        indicativeFromYear: pay.indicativeFromYear,
        verifiedAt: pay.verifiedAt,
        reviewedAt: m.reviewedAt,
        tuitionMissing,
        tuitionVerified,
        unknownReason: inferUnknownReason({
          hasValue: !tuitionMissing,
          indicativeFromYear: pay.indicativeFromYear,
          academicYear: pay.academicYear,
          intake: student.intake,
          verified: tuitionVerified,
        }),
      };
    }),
    lastStudentMessageAt: lastStudentMessage?.at ?? null,
    lastCuratorReplyAt: lastCuratorReply?.at ?? null,
    dismissedSourceKeys: [],
  };
  const studentQueue = buildWorkQueue({ students: [queueStudent] });

  const confirmedDeadlines = [
    ...student.deadlines
      .filter((d) => d.isHardDeadline || d.type === "HARD")
      .map((d) => d.date),
    ...student.applications
      .map((a) => a.hardDeadline)
      .filter((d): d is Date => d != null),
  ].sort((a, b) => a.getTime() - b.getTime());
  const nearestDeadline = confirmedDeadlines[0]
    ? formatDate(confirmedDeadlines[0])
    : null;

  const next = parseNextAction(student.nextActionJson);
  const docsApproved = student.documents.filter((d) => d.status === "APPROVED")
    .length;
  const stageIndex = STAGES.indexOf(
    student.journeyStage as (typeof STAGES)[number]
  );

  const docsByCategory = student.documents.reduce<
    Record<string, typeof student.documents>
  >((acc, doc) => {
    (acc[doc.category] ??= []).push(doc);
    return acc;
  }, {});

  return (
    <div className="space-y-5">
      <div className="flex items-start gap-3">
        <StudentAvatar
          firstName={student.firstName}
          lastName={student.lastName}
          size="lg"
        />
        <div className="min-w-0 flex-1">
          <PageHeader
            title={fullName(student.firstName, student.lastName)}
            description={`${student.email}${
              student.country ? ` · ${student.country}` : ""
            }${student.curator ? ` · Куратор: ${student.curator.name}` : ""} · ${
              labelOf(student.studyLevel)
            } · Набор ${student.intake}${
              student.targetField ? ` · ${student.targetField}` : ""
            } · Анкета: ${questionnaireDone ? "заполнена" : "не заполнена"}`}
            actions={
              <>
                <StatusBadge status={student.status} kind="student" />
                <RiskBadge level={student.riskLevel} />
                <Button asChild size="sm" variant="outline">
                  <Link href={`/admin/students/${studentId}?tab=applications`}>
                    Подачи
                  </Link>
                </Button>
              </>
            }
          />
        </div>
      </div>

      <StudentAdminSummary
        studentId={studentId}
        stage={curatorStageForStudent(queueStudent)}
        nextStep={
          studentQueue.items[0]?.action ??
          next?.title ??
          "Нет следующего шага"
        }
        curatorName={student.curator?.name ?? null}
        curatorAssigned={Boolean(student.curatorId)}
        canAssignToMe={!student.curatorId}
        programsCount={shortlist.length}
        documentsApproved={docsApproved}
        documentsTotal={student.documents.length}
        applicationsCount={student.applications.length}
        nearestDeadline={nearestDeadline}
        openTasks={studentQueue.items}
      />

      <div className="flex flex-wrap gap-1 border-b border-border pb-px">
        {TABS.map((t) => (
          <Link
            key={t.id}
            href={`/admin/students/${studentId}?tab=${t.id}`}
            className={cn(
              "-mb-px border-b-2 px-3 py-2 text-xs font-medium transition-colors",
              tab === t.id
                ? "border-neutral-900 text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground"
            )}
          >
            {t.label}
          </Link>
        ))}
      </div>

      {tab === "overview" ? (
        <div className="space-y-4">
          {curatorNotifications.length > 0 ? (
            <Card>
              <CardHeader>
                <CardTitle>Уведомления по программам</CardTitle>
              </CardHeader>
              <CardContent>
                <InAppNotificationsPanel items={curatorNotifications} />
              </CardContent>
            </Card>
          ) : null}
          <Card>
            <CardHeader>
              <CardTitle>Путь</CardTitle>
            </CardHeader>
            <CardContent>
              <ol className="flex flex-wrap gap-2">
                {STAGES.map((stage, i) => (
                  <li key={stage}>
                    <Badge
                      variant={
                        i < stageIndex
                          ? "success"
                          : i === stageIndex
                            ? "default"
                            : "muted"
                      }
                    >
                      {labelOf(stage, JOURNEY_LABELS)}
                    </Badge>
                  </li>
                ))}
              </ol>
            </CardContent>
          </Card>

          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>Подачи</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {student.applications.length === 0 ? (
                  <EmptyState
                    title="Нет подач"
                    description="Создайте первую подачу на программу."
                    className="py-6"
                  />
                ) : (
                  student.applications.slice(0, 4).map((app) => (
                    <ApplicationCard
                      key={app.id}
                      id={app.id}
                      programName={app.program.name}
                      universityName={app.program.university.name}
                      status={app.status}
                      riskLevel={app.riskLevel}
                      readinessPct={app.readinessPercent}
                      deadline={app.hardDeadline}
                      href={`/admin/students/${studentId}/applications/${app.id}`}
                    />
                  ))
                )}
              </CardContent>
            </Card>

            <div className="space-y-4">
              <Card>
                <CardHeader>
                  <CardTitle>Текущие задачи</CardTitle>
                </CardHeader>
                <CardContent>
                  <TaskList
                    tasks={student.tasks.slice(0, 8).map((t) => ({
                      id: t.id,
                      title: t.title,
                      status: t.status,
                      priority: t.priority,
                      dueDate: t.dueDate,
                      href: `/admin/students/${studentId}?tab=tasks`,
                    }))}
                  />
                </CardContent>
              </Card>
              <Card>
                <CardHeader>
                  <CardTitle>Дедлайны</CardTitle>
                </CardHeader>
                <CardContent>
                  <DeadlineList
                    deadlines={student.deadlines.map((d) => ({
                      id: d.id,
                      title: d.title,
                      dueDate: d.date,
                      type: d.type,
                      href: d.applicationId
                        ? `/admin/students/${studentId}/applications/${d.applicationId}`
                        : undefined,
                    }))}
                  />
                </CardContent>
              </Card>
            </div>
          </div>

          <Card>
            <CardHeader>
              <CardTitle>Недавняя активность</CardTitle>
            </CardHeader>
            <CardContent>
              <ActivityTimeline
                items={student.activities.slice(0, 8).map((a) => ({
                  id: a.id,
                  type: a.type,
                  title: activityLabel(a.type as ActivityType, a.metadata),
                  description: a.metadata,
                  actorName: a.user?.name,
                  createdAt: a.createdAt,
                }))}
              />
            </CardContent>
          </Card>
        </div>
      ) : null}

      {tab === "programs" ? (
        <div className="space-y-4">
          <div className="flex flex-wrap items-start gap-2">
            <GenerateProgramMatchesButton
              studentId={studentId}
              disabled={!matchingReady}
            />
            {persistedMatches.length > 0 || shortlist.length > 0 ? (
              <ResetProgramMatchesButton studentId={studentId} />
            ) : null}
            <ResetUniversitalyCacheButton />
          </div>
          {!matchingReady ? (
            <p className="text-xs text-muted-foreground">
              Заполните анкету №2, чтобы запускать подбор.
            </p>
          ) : null}
          <div className="space-y-6">
            <section className="space-y-3">
              <h3 className="text-sm font-semibold">Короткий список студента</h3>
              {shortlistViews.length === 0 ? (
                <EmptyState
                  title="Короткий список пуст"
                  description="Программы появятся здесь, когда студент или куратор добавят их в короткий список."
                  className="py-6"
                />
              ) : (
                <div className="grid gap-3 lg:grid-cols-2">
                  {shortlistViews.map((m) => (
                    <CuratorProgramLevelsCard
                      key={m.matchId}
                      match={m}
                      focused={focusPayId === m.programAcademicYearId}
                    />
                  ))}
                </div>
              )}
            </section>

            <section className="space-y-3">
              <h3 className="text-sm font-semibold">Программы на проверке</h3>
              {reviewViews.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  Нет программ, ожидающих проверки куратора.
                </p>
              ) : (
                <div className="grid gap-3 lg:grid-cols-2">
                  {reviewViews.map((m) => (
                    <CuratorProgramLevelsCard
                      key={m.matchId}
                      match={m}
                      focused={focusPayId === m.programAcademicYearId}
                    />
                  ))}
                </div>
              )}
            </section>

            <section className="space-y-3">
              <h3 className="text-sm font-semibold">Остальные варианты</h3>
              <ShowAllMatches count={otherMatchViews.length}>
                <div className="grid gap-3 lg:grid-cols-2">
                  {otherMatchViews.map((m) => (
                    <CuratorProgramLevelsCard
                      key={m.matchId}
                      match={m}
                      focused={focusPayId === m.programAcademicYearId}
                    />
                  ))}
                </div>
              </ShowAllMatches>
            </section>
          </div>

          <details className="rounded-2xl border border-border bg-card px-4 py-3">
            <summary className="cursor-pointer text-sm font-medium">
              Профиль подбора и генерация
            </summary>
            <div className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle>Профиль подбора</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <dl className="grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
                <div>
                  <dt className="text-xs text-muted-foreground">Целевой набор</dt>
                  <dd className="font-medium">
                    {matchingProfile?.targetAcademicYear ?? student.intake}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">Степень</dt>
                  <dd className="font-medium">
                    {labelOf(
                      String(matchingProfile?.desiredDegreeLevel ?? student.studyLevel)
                    )}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">Категория абитуриента</dt>
                  <dd className="font-medium">
                    {labelApplicantCategory(matchingProfile?.applicantCategory)}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">Последний подбор</dt>
                  <dd className="font-medium">
                    {persistedMatches[0]?.generatedAt
                      ? formatDate(persistedMatches[0].generatedAt)
                      : "—"}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">Найдено программ</dt>
                  <dd className="font-medium">{persistedMatches.length}</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">На проверке</dt>
                  <dd className="font-medium">
                    {
                      persistedMatches.filter(
                        (m) =>
                          m.curatorStatus === "NEEDS_REVIEW" ||
                          m.eligibilityStatus === "NEEDS_REVIEW"
                      ).length
                    }
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">Короткий список</dt>
                  <dd className="font-medium">{shortlist.length}</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">Языки</dt>
                  <dd className="font-medium">
                    {(matchingProfile?.preferredTeachingLanguages || []).join(", ") ||
                      student.preferredLanguage ||
                      "—"}
                  </dd>
                </div>
                <div className="sm:col-span-2 lg:col-span-4">
                  <dt className="text-xs text-muted-foreground">Предпочтительные города</dt>
                  <dd className="mt-1 flex flex-wrap gap-1.5">
                    {(matchingProfile?.preferredCities?.length
                      ? matchingProfile.preferredCities
                      : preferredCities
                    ).length === 0 ? (
                      <span className="text-muted-foreground">не указаны</span>
                    ) : (
                      (matchingProfile?.preferredCities?.length
                        ? matchingProfile.preferredCities
                        : preferredCities
                      ).map((c) => (
                        <Badge key={c} variant="muted">
                          {c}
                        </Badge>
                      ))
                    )}
                  </dd>
                </div>
              </dl>
              {matchingProfile?.missingFields?.length ? (
                <div>
                  <p className="text-xs font-medium text-muted-foreground">
                    Не хватает данных
                  </p>
                  <ul className="mt-1 flex flex-wrap gap-1.5">
                    {matchingProfile.missingFields.map((f) => (
                      <Badge key={f} variant="muted">
                        {f}
                      </Badge>
                    ))}
                  </ul>
                </div>
              ) : null}
              <GenerateProgramMatchesButton
                studentId={studentId}
                disabled={!matchingReady}
              />
              {(() => {
                const lastGen = student.activities.find(
                  (a) => a.type === "PROGRAM_MATCH_GENERATED"
                );
                if (!lastGen?.metadata) return null;
                try {
                  const meta = JSON.parse(lastGen.metadata) as {
                    warning?: string | null;
                    source?: string;
                    candidateCount?: number;
                    pagesFetched?: number;
                    usedSynonymFallback?: boolean;
                    exactShareTop20?: number;
                    secondaryShareTop20?: number;
                    underfill?: boolean;
                    highQualityCount?: number;
                    excludedSecondarySynonym?: number;
                    gateHistogram?: {
                      city_excluded?: number;
                      no_classe_no_tag?: number;
                      passed?: number;
                    };
                    coverageQueried?: Array<{
                      classeCode?: string;
                      lingua?: string;
                      sourceDirections?: string[];
                    }>;
                    coverageDeferred?: Array<{
                      classeCode?: string;
                      lingua?: string;
                      sourceDirections?: string[];
                      reason?: string;
                    }>;
                    coverage?: {
                      queried?: Array<{
                        classeCode?: string;
                        lingua?: string;
                        sourceDirections?: string[];
                      }>;
                      deferred?: Array<{
                        classeCode?: string;
                        lingua?: string;
                        sourceDirections?: string[];
                        reason?: string;
                      }>;
                    };
                  };
                  const queried =
                    meta.coverageQueried ?? meta.coverage?.queried ?? [];
                  const deferred =
                    meta.coverageDeferred ?? meta.coverage?.deferred ?? [];
                  if (
                    !meta.warning &&
                    meta.source !== "universitaly-live" &&
                    meta.source !== "universitaly-cache" &&
                    queried.length === 0 &&
                    deferred.length === 0
                  ) {
                    return null;
                  }
                  return (
                    <div
                      className={cn(
                        "space-y-2 rounded-xl border px-3 py-2 text-sm",
                        meta.warning
                          ? "border-amber-300 bg-amber-50 text-amber-950"
                          : "border-border bg-muted/40 text-muted-foreground"
                      )}
                    >
                      {meta.warning ? (
                        <p>{meta.warning}</p>
                      ) : (
                        <p>
                          Universitaly {meta.source === "universitaly-cache" ? "cache" : "live"}:{" "}
                          {meta.candidateCount ?? 0} candidates
                          {meta.pagesFetched
                            ? ` (${meta.pagesFetched} pages)`
                            : ""}
                          .
                        </p>
                      )}
                      {meta.usedSynonymFallback ? (
                        <p className="text-xs">Synonym fallback was merged.</p>
                      ) : null}
                      {typeof meta.exactShareTop20 === "number" ? (
                        <p className="text-xs">
                          Top-20 evidence: exact {meta.exactShareTop20}%, secondary{" "}
                          {meta.secondaryShareTop20 ?? 0}%
                          {meta.underfill ? " · underfill" : ""}
                          {typeof meta.excludedSecondarySynonym === "number" &&
                          meta.excludedSecondarySynonym > 0
                            ? ` · excluded ${meta.excludedSecondarySynonym} weak matches`
                            : ""}
                        </p>
                      ) : null}
                      {meta.gateHistogram ? (
                        <p className="text-xs">
                          Gate: passed {meta.gateHistogram.passed ?? 0}, dropped tag/classe{" "}
                          {meta.gateHistogram.no_classe_no_tag ?? 0}, city excluded{" "}
                          {meta.gateHistogram.city_excluded ?? 0}
                        </p>
                      ) : null}
                      {queried.length > 0 ? (
                        <p className="text-xs">
                          Queried:{" "}
                          {queried
                            .map(
                              (q) =>
                                `${q.classeCode ?? "?"} ${q.lingua ?? ""}`.trim()
                            )
                            .join(", ")}
                        </p>
                      ) : null}
                      {deferred.length > 0 ? (
                        <p className="text-xs">
                          Deferred (page budget):{" "}
                          {deferred
                            .map(
                              (d) =>
                                `${d.classeCode ?? "?"} (${(d.sourceDirections ?? []).join(", ")})`
                            )
                            .join("; ")}
                        </p>
                      ) : null}
                    </div>
                  );
                } catch {
                  return null;
                }
              })()}
              {!matchingReady ? (
                <p className="text-xs text-muted-foreground">
                  Заполните анкету №2, чтобы запускать подбор.
                </p>
              ) : null}
            </CardContent>
          </Card>
            </div>
          </details>

          <details className="rounded-2xl border border-border bg-card px-4 py-3">
            <summary className="cursor-pointer text-sm font-medium">
              Фильтры
            </summary>
            <div className="mt-3">
          <Card>
            <CardContent>
              <form className="flex flex-wrap gap-2 text-sm" method="get">
                <input type="hidden" name="tab" value="programs" />
                <select
                  name="eligibility"
                  defaultValue={sp.eligibility || ""}
                  className="h-8 rounded-xl border border-input bg-card px-2 text-[13px]"
                >
                  <option value="">Eligibility</option>
                  <option value="ELIGIBLE">ELIGIBLE</option>
                  <option value="LIKELY_ELIGIBLE">LIKELY_ELIGIBLE</option>
                  <option value="NEEDS_REVIEW">NEEDS_REVIEW</option>
                  <option value="NOT_ELIGIBLE">NOT_ELIGIBLE</option>
                </select>
                <select
                  name="confidence"
                  defaultValue={sp.confidence || ""}
                  className="h-8 rounded-xl border border-input bg-card px-2 text-[13px]"
                >
                  <option value="">Data confidence</option>
                  <option value="HIGH">HIGH</option>
                  <option value="MEDIUM">MEDIUM</option>
                  <option value="LOW">LOW</option>
                </select>
                <select
                  name="curator"
                  defaultValue={sp.curator || ""}
                  className="h-8 rounded-xl border border-input bg-card px-2 text-[13px]"
                >
                  <option value="">Curator status</option>
                  <option value="AUTO_MATCHED">AUTO_MATCHED</option>
                  <option value="NEEDS_REVIEW">NEEDS_REVIEW</option>
                  <option value="APPROVED">APPROVED</option>
                  <option value="REJECTED">REJECTED</option>
                  <option value="SHORTLISTED">SHORTLISTED</option>
                </select>
                <Input
                  name="city"
                  placeholder="City"
                  defaultValue={sp.city || ""}
                  className="h-8 w-[120px]"
                />
                <select
                  name="language"
                  defaultValue={sp.language || ""}
                  className="h-8 rounded-xl border border-input bg-card px-2 text-[13px]"
                >
                  <option value="">Language</option>
                  <option value="English">English</option>
                  <option value="Italian">Italian</option>
                </select>
                <select
                  name="publicPrivate"
                  defaultValue={sp.publicPrivate || ""}
                  className="h-8 rounded-xl border border-input bg-card px-2 text-[13px]"
                >
                  <option value="">Public / Private</option>
                  <option value="PUBLIC">Public</option>
                  <option value="PRIVATE">Private</option>
                  <option value="UNKNOWN">Unknown</option>
                </select>
                <select
                  name="accessMode"
                  defaultValue={sp.accessMode || ""}
                  className="h-8 rounded-xl border border-input bg-card px-2 text-[13px]"
                >
                  <option value="">Access</option>
                  <option value="OPEN">Open</option>
                  <option value="CLOSED">Closed</option>
                  <option value="UNKNOWN">Unknown</option>
                </select>
                <select
                  name="hasExam"
                  defaultValue={sp.hasExam || ""}
                  className="h-8 rounded-xl border border-input bg-card px-2 text-[13px]"
                >
                  <option value="">Exams</option>
                  <option value="ANY">Any exam</option>
                  <option value="NONE">No exam listed</option>
                  <option value="TOLC">TOLC</option>
                  <option value="SAT">SAT</option>
                  <option value="IELTS">IELTS</option>
                </select>
                <select
                  name="callFreshness"
                  defaultValue={sp.callFreshness || ""}
                  className="h-8 rounded-xl border border-input bg-card px-2 text-[13px]"
                >
                  <option value="">Call freshness</option>
                  <option value="current">Current year</option>
                  <option value="indicative">Indicative</option>
                  <option value="unknown">Unknown</option>
                </select>
                <Button type="submit" size="sm" variant="outline">
                  Apply
                </Button>
              </form>
            </CardContent>
          </Card>
            </div>
          </details>

          <Card>
            <CardHeader>
              <CardTitle>Добавить программу вручную</CardTitle>
            </CardHeader>
            <CardContent>
              <form
                action={addManualProgramMatchAction}
                className="flex flex-wrap items-end gap-2"
              >
                <input type="hidden" name="studentId" value={studentId} />
                <div className="min-w-[240px] flex-1 space-y-1.5">
                  <Label htmlFor="manualProgramId">Program database</Label>
                  <select
                    id="manualProgramId"
                    name="programId"
                    required
                    className="flex h-8 w-full rounded-xl border border-input bg-card px-2.5 text-[13px]"
                  >
                    <option value="">Search / select…</option>
                    {programs.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.university.name} — {p.name} ({labelOf(p.degreeLevel)})
                      </option>
                    ))}
                  </select>
                </div>
                <Button type="submit" size="sm">
                  Evaluate & shortlist
                </Button>
              </form>
            </CardContent>
          </Card>

          <details className="rounded-2xl border border-border bg-card px-4 py-3">
            <summary className="cursor-pointer text-sm font-medium">
              Фильтры и подбор
            </summary>
            <div className="mt-4 space-y-4">

          <Card>
            <CardHeader>
              <CardTitle>Анкета №1 — личная информация</CardTitle>
            </CardHeader>
            <CardContent>
              {!student.questionnairePersonalJson ? (
                <EmptyState
                  title="Анкета №1 не заполнена"
                  description="Студент ещё не отправил личную анкету в портале."
                  className="py-6"
                />
              ) : (
                <div className="space-y-5">
                  {PERSONAL_QUESTIONNAIRE_SECTIONS.map((section) => (
                    <div key={section.id}>
                      <h4 className="mb-2 rounded-xl bg-muted px-3 py-1.5 text-xs font-semibold text-foreground">
                        {section.title}
                      </h4>
                      <dl className="space-y-2 text-sm">
                        {section.fields.map((field) => {
                          const raw = personalAnswers[field.id];
                          const display = Array.isArray(raw)
                            ? raw.join(", ")
                            : raw || "—";
                          return (
                            <div
                              key={field.id}
                              className="border-b border-border/60 pb-2 last:border-0"
                            >
                              <dt className="text-xs text-muted-foreground">
                                {field.label}
                              </dt>
                              <dd className="mt-0.5 font-medium whitespace-pre-wrap">
                                {field.id === "gmailPassword" ? "••••••••" : display}
                              </dd>
                            </div>
                          );
                        })}
                      </dl>
                    </div>
                  ))}
                  {student.questionnaireAt ? (
                    <p className="text-xs text-muted-foreground">
                      Обновлено: {formatDate(student.questionnaireAt)}
                    </p>
                  ) : null}
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Анкета №2 — подбор программ</CardTitle>
            </CardHeader>
            <CardContent>
              {!student.questionnaireProgramsJson ? (
                <EmptyState
                  title="Анкета №2 не заполнена"
                  description="Студент ещё не отправил анкету по подбору программ."
                  className="py-6"
                />
              ) : (
                <div className="space-y-5">
                  {PROGRAMS_QUESTIONNAIRE_SECTIONS.map((section) => (
                    <div key={section.id}>
                      <h4 className="mb-2 rounded-xl bg-muted px-3 py-1.5 text-xs font-semibold text-foreground">
                        {section.title}
                      </h4>
                      <dl className="space-y-2 text-sm">
                        {section.fields.map((field) => {
                          const raw = programsAnswers[field.id];
                          const display = Array.isArray(raw)
                            ? raw.join(", ")
                            : raw || "—";
                          return (
                            <div
                              key={field.id}
                              className="border-b border-border/60 pb-2 last:border-0"
                            >
                              <dt className="text-xs text-muted-foreground">
                                {field.label}
                              </dt>
                              <dd className="mt-0.5 font-medium whitespace-pre-wrap">
                                {display}
                              </dd>
                            </div>
                          );
                        })}
                      </dl>
                    </div>
                  ))}
                  {student.questionnaireProgramsAt ? (
                    <p className="text-xs text-muted-foreground">
                      Обновлено: {formatDate(student.questionnaireProgramsAt)}
                    </p>
                  ) : null}
                </div>
              )}
            </CardContent>
          </Card>
            </div>
          </details>
        </div>
      ) : null}

      {tab === "applications" ? (
        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Новая подача</CardTitle>
            </CardHeader>
            <CardContent>
              <form
                action={createApplicationAction}
                className="grid gap-3 sm:grid-cols-2"
              >
                <input type="hidden" name="studentId" value={studentId} />
                <div className="space-y-1.5 sm:col-span-2">
                  <Label htmlFor="programId">Программа</Label>
                  <select
                    id="programId"
                    name="programId"
                    required
                    className="flex h-8 w-full rounded-xl border border-input bg-card px-2.5 text-[13px]"
                  >
                    <option value="">Выберите программу…</option>
                    {programs.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.university.name} — {p.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="intake">Набор</Label>
                  <Input
                    id="intake"
                    name="intake"
                    defaultValue={student.intake}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="hardDeadline">Жёсткий дедлайн</Label>
                  <Input id="hardDeadline" name="hardDeadline" type="date" />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="targetSubmissionDate">Целевая подача</Label>
                  <Input
                    id="targetSubmissionDate"
                    name="targetSubmissionDate"
                    type="date"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="templateId">Шаблон</Label>
                  <select
                    id="templateId"
                    name="templateId"
                    className="flex h-8 w-full rounded-xl border border-input bg-card px-2.5 text-[13px]"
                  >
                    <option value="">Нет</option>
                    {templates.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="sm:col-span-2">
                  <Button type="submit" size="sm">
                    Создать подачу
                  </Button>
                </div>
              </form>
            </CardContent>
          </Card>

          <div className="grid gap-2 sm:grid-cols-2">
            {student.applications.map((app) => {
              const blockers = criticalIncomplete(app.requirements);
              return (
                <div key={app.id} className="space-y-1">
                  <ApplicationCard
                    id={app.id}
                    programName={app.program.name}
                    universityName={app.program.university.name}
                    status={app.status}
                    riskLevel={app.riskLevel}
                    readinessPct={app.readinessPercent}
                    deadline={app.hardDeadline}
                    href={`/admin/students/${studentId}/applications/${app.id}`}
                  />
                  {blockers.length > 0 ? (
                    <p className="px-1 text-[11px] text-orange-700">
                      Что мешает: {blockers.map((b) => b.name).join(", ")}
                    </p>
                  ) : null}
                </div>
              );
            })}
          </div>
        </div>
      ) : null}

      {tab === "documents" ? (
        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Добавить документ</CardTitle>
            </CardHeader>
            <CardContent>
              <form
                action={createDocumentAction}
                className="flex flex-wrap items-end gap-2"
              >
                <input type="hidden" name="studentId" value={studentId} />
                <div className="min-w-[180px] flex-1 space-y-1.5">
                  <Label htmlFor="docName">Название</Label>
                  <Input id="docName" name="name" required />
                </div>
                <div className="w-[140px] space-y-1.5">
                  <Label htmlFor="category">Категория</Label>
                  <select
                    id="category"
                    name="category"
                    className="flex h-8 w-full rounded-xl border border-input bg-card px-2 text-[13px]"
                    defaultValue="OTHER"
                  >
                    <option value="PERSONAL">Личные</option>
                    <option value="EDUCATION">Образование</option>
                    <option value="LANGUAGE">Язык</option>
                    <option value="EXAMS">Экзамены</option>
                    <option value="OTHER">Другое</option>
                  </select>
                </div>
                <Button type="submit" size="sm">
                  Добавить
                </Button>
              </form>
            </CardContent>
          </Card>

          {Object.keys(docsByCategory).length === 0 ? (
            <EmptyState
              title="Хранилище документов пусто"
              description="Запросите или создайте документы для этого студента."
            />
          ) : (
            Object.entries(docsByCategory).map(([category, docs]) => (
              <Card key={category}>
                <CardHeader>
                  <CardTitle>{labelOf(category)}</CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                  {docs.map((doc) => (
                    <div
                      key={doc.id}
                      className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border px-3 py-2"
                    >
                      <div className="min-w-0">
                        <p className="text-[13px] font-medium">{doc.name}</p>
                        <p className="text-[11px] text-muted-foreground">
                          v{doc.version}
                          {doc.uploadedAt
                            ? ` · загружен ${formatDate(doc.uploadedAt)}`
                            : ""}
                        </p>
                      </div>
                      <div className="flex flex-wrap items-center gap-1.5">
                        <DocumentStatusBadge status={doc.status} />
                        {doc.status === "MISSING" ||
                        doc.status === "NEEDS_CHANGES" ? (
                          <form
                            action={requestDocumentAction.bind(null, doc.id)}
                          >
                            <Button type="submit" size="sm" variant="outline">
                              Запросить
                            </Button>
                          </form>
                        ) : null}
                        {doc.status === "UPLOADED" ||
                        doc.status === "UNDER_REVIEW" ? (
                          <>
                            <form
                              action={approveDocumentAction.bind(null, doc.id)}
                            >
                              <Button type="submit" size="sm">
                                Одобрить
                              </Button>
                            </form>
                            <form
                              action={needsChangesAction}
                              className="flex items-center gap-1"
                            >
                              <input
                                type="hidden"
                                name="documentId"
                                value={doc.id}
                              />
                              <Input
                                name="reason"
                                placeholder="Причина"
                                className="h-7 w-28"
                              />
                              <Button type="submit" size="sm" variant="outline">
                                Правки
                              </Button>
                            </form>
                          </>
                        ) : null}
                      </div>
                    </div>
                  ))}
                </CardContent>
              </Card>
            ))
          )}
        </div>
      ) : null}

      {tab === "overview" ? (
        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Создать задачу</CardTitle>
            </CardHeader>
            <CardContent>
              <form
                action={createTaskAction}
                className="grid gap-3 sm:grid-cols-2"
              >
                <input type="hidden" name="studentId" value={studentId} />
                <div className="space-y-1.5 sm:col-span-2">
                  <Label htmlFor="title">Название</Label>
                  <Input id="title" name="title" required />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="dueDate">Срок</Label>
                  <Input id="dueDate" name="dueDate" type="date" />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="priority">Приоритет</Label>
                  <select
                    id="priority"
                    name="priority"
                    defaultValue="MEDIUM"
                    className="flex h-8 w-full rounded-xl border border-input bg-card px-2.5 text-[13px]"
                  >
                    <option value="LOW">Низкий</option>
                    <option value="MEDIUM">Средний</option>
                    <option value="HIGH">Высокий</option>
                    <option value="URGENT">Срочный</option>
                  </select>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="applicationId">Подача</Label>
                  <select
                    id="applicationId"
                    name="applicationId"
                    className="flex h-8 w-full rounded-xl border border-input bg-card px-2.5 text-[13px]"
                  >
                    <option value="">Нет</option>
                    {student.applications.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.program.university.name} — {a.program.name}
                      </option>
                    ))}
                  </select>
                </div>
                <label className="flex items-center gap-2 self-end text-xs pb-2">
                  <input type="checkbox" name="isStudentFacing" />
                  Видно студенту
                </label>
                <div className="sm:col-span-2">
                  <Button type="submit" size="sm">
                    Создать задачу
                  </Button>
                </div>
              </form>
            </CardContent>
          </Card>
          <TaskList
            tasks={student.tasks.map((t) => ({
              id: t.id,
              title: t.title,
              status: t.status,
              priority: t.priority,
              dueDate: t.dueDate,
            }))}
          />
        </div>
      ) : null}

      {tab === "history" ? (
        <Card>
          <CardHeader>
            <CardTitle>Хронология активности</CardTitle>
          </CardHeader>
          <CardContent>
            <ActivityTimeline
              items={student.activities.map((a) => ({
                id: a.id,
                type: a.type,
                title: activityLabel(a.type as ActivityType, a.metadata),
                description: a.metadata,
                actorName: a.user?.name,
                createdAt: a.createdAt,
              }))}
            />
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
