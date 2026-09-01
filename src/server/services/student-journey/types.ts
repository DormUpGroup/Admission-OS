export const JOURNEY_STAGE_IDS = [
  "PROGRAMS",
  "REQUIREMENTS",
  "DOCUMENTS",
  "SUBMISSION",
] as const;

export type JourneyStageId = (typeof JOURNEY_STAGE_IDS)[number];

export const JOURNEY_STAGE_STATUSES = [
  "CURRENT",
  "DONE",
  "NEXT",
  "WAITING_CURATOR",
  "UNAVAILABLE",
] as const;

export type JourneyStageStatus = (typeof JOURNEY_STAGE_STATUSES)[number];

export const PROGRAM_PREVIEW_STATUSES = [
  "NEEDS_CHOICE",
  "SELECTED",
  "CURATOR_REVIEWING",
] as const;

export type ProgramPreviewStatus = (typeof PROGRAM_PREVIEW_STATUSES)[number];

export const JOURNEY_TASK_KINDS = [
  "DEADLINE",
  "STUDENT_ACTION",
  "CURATOR_REQUEST",
  "INFO",
] as const;

export type JourneyTaskKind = (typeof JOURNEY_TASK_KINDS)[number];

export type JourneyStageView = {
  id: JourneyStageId;
  label: string;
  status: JourneyStageStatus;
  statusLabel: string;
};

export type JourneyPrimaryCta = {
  label: string;
  href: string;
};

export type JourneyNowTask = {
  id: string;
  title: string;
  reason: string;
  dueDate: string | null;
  dueDateOverdue: boolean;
  actionLabel: string;
  actionHref: string;
  kind: JourneyTaskKind;
};

export type JourneyProgramPreview = {
  programId: string;
  universityName: string;
  programName: string;
  city: string | null;
  language: string | null;
  whyFits: string | null;
  status: ProgramPreviewStatus;
  statusLabel: string;
  previousYearNote: string | null;
};

export type JourneyProgramsBlock = {
  consideringCount: number;
  selectedCount: number;
  previews: JourneyProgramPreview[];
  allHref: string;
};

export type JourneyDocumentsBlock = {
  approvedCount: number;
  totalCount: number;
  awaitingReviewCount: number;
  href: string;
};

export type JourneyCuratorBlock = {
  assigned: boolean;
  name: string | null;
  /** Only when a real workspace setting exists. Currently always null. */
  responseHint: string | null;
  emptyMessage: string | null;
  writeHref: string;
};

export type StudentJourneyView = {
  currentStage: JourneyStageId;
  headline: string;
  primaryCta: JourneyPrimaryCta;
  stages: JourneyStageView[];
  nowTasks: JourneyNowTask[];
  nowEmptyMessage: string | null;
  programs: JourneyProgramsBlock;
  documents: JourneyDocumentsBlock | null;
  curator: JourneyCuratorBlock;
};

export type StudentJourneyProgramInput = {
  programId: string;
  universityName: string;
  programName: string;
  city: string | null;
  language: string | null;
  reasons: string[];
  curatorNote: string | null;
  source: "match" | "shortlist" | "application";
  curatorStatus: string | null;
  hasApplication: boolean;
  academicYear: string | null;
  indicativeFromYear: string | null;
  verifiedAt: Date | null;
  rejected: boolean;
};

export type StudentJourneyApplicationInput = {
  id: string;
  programId: string;
  status: string;
  hardDeadline: Date | null;
  submittedAt: Date | null;
  requirementCount: number;
};

export type StudentJourneyDocumentInput = {
  id: string;
  name: string;
  status: string;
  requestedAt: Date | null;
  studentFeedback: string | null;
};

export type StudentJourneyTaskInput = {
  id: string;
  title: string;
  description: string | null;
  dueDate: Date | null;
  documentId: string | null;
  applicationId: string | null;
};

export type StudentJourneyDeadlineInput = {
  id: string;
  title: string;
  date: Date;
  isInternal: boolean;
  applicationId: string | null;
  taskId: string | null;
};

export type StudentJourneyInput = {
  intake: string | null;
  hasQuestionnaire: boolean;
  hasMatchingProfile: boolean;
  curator: { id: string; name: string } | null;
  programs: StudentJourneyProgramInput[];
  applications: StudentJourneyApplicationInput[];
  documents: StudentJourneyDocumentInput[];
  tasks: StudentJourneyTaskInput[];
  deadlines: StudentJourneyDeadlineInput[];
  now?: Date;
};
