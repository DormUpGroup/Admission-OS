import type { JourneyStageId } from "@/server/services/student-journey/types";
import type { FieldUnknownReason } from "@/lib/program-matching/field-status";

export const WORK_QUEUE_GROUPS = [
  "URGENT",
  "NEEDS_DECISION",
  "WAITING_STUDENT",
  "ON_WATCH",
] as const;

export type WorkQueueGroupId = (typeof WORK_QUEUE_GROUPS)[number];

export const WORK_QUEUE_GROUP_LABELS: Record<WorkQueueGroupId, string> = {
  URGENT: "Срочно",
  NEEDS_DECISION: "Требует вашего решения",
  WAITING_STUDENT: "Ожидаем студента",
  ON_WATCH: "На контроле",
};

export const WORK_QUEUE_TASK_TYPES = [
  "OVERDUE_DEADLINE",
  "UPCOMING_DEADLINE",
  "DOCUMENT_REVIEW",
  "NEW_QUESTIONNAIRE",
  "SHORTLIST_REVIEW",
  "STUDENT_MESSAGE",
  "PREVIOUS_YEAR_CALL",
  "CONFIRM_FIELD",
  "WAITING_DOCUMENT",
  "APPLICATION_REVIEW",
  "OPEN_TASK",
] as const;

export type WorkQueueTaskType = (typeof WORK_QUEUE_TASK_TYPES)[number];

export const WORK_QUEUE_STAGE_LABELS: Record<JourneyStageId, string> = {
  PROGRAMS: "Программы",
  REQUIREMENTS: "Требования",
  DOCUMENTS: "Документы",
  SUBMISSION: "Подача",
};

export type WorkQueueItem = {
  id: string;
  sourceKey: string;
  type: WorkQueueTaskType;
  group: WorkQueueGroupId;
  priority: number;
  studentId: string;
  studentName: string;
  stage: JourneyStageId;
  stageLabel: string;
  action: string;
  reason: string;
  deadline: string | null;
  deadlineOverdue: boolean;
  href: string;
  assignable: boolean;
};

export type WorkQueueCounters = {
  newQuestionnaires: number;
  needsReview: number;
  deadlinesNext7Days: number;
};

export type WorkQueueGroup = {
  id: WorkQueueGroupId;
  label: string;
  items: WorkQueueItem[];
};

export type WorkQueueView = {
  counters: WorkQueueCounters;
  groups: WorkQueueGroup[];
  items: WorkQueueItem[];
  empty: boolean;
};

export type WorkQueueDeadlineInput = {
  id: string;
  title: string;
  date: Date;
  isHardDeadline: boolean;
  type: string;
  applicationId: string | null;
};

export type WorkQueueDocumentInput = {
  id: string;
  name: string;
  status: string;
  requestedAt: Date | null;
};

export type WorkQueueTaskInput = {
  id: string;
  title: string;
  status: string;
  dueDate: Date | null;
  isStudentFacing: boolean;
  documentId: string | null;
  applicationId: string | null;
};

export type WorkQueueApplicationInput = {
  id: string;
  programId: string;
  status: string;
  hardDeadline: Date | null;
  requirementCount: number;
};

export type WorkQueueProgramInput = {
  matchId: string | null;
  programId: string;
  programAcademicYearId: string;
  programName: string;
  universityName: string;
  curatorStatus: string | null;
  eligibilityStatus: string | null;
  inShortlist: boolean;
  hasApplication: boolean;
  academicYear: string | null;
  indicativeFromYear: string | null;
  verifiedAt: Date | null;
  reviewedAt: Date | null;
  tuitionMissing: boolean;
  tuitionVerified: boolean;
  unknownReason: FieldUnknownReason | null;
};

export type WorkQueueStudentInput = {
  id: string;
  firstName: string;
  lastName: string;
  curatorId: string | null;
  intake: string | null;
  hasQuestionnaire: boolean;
  hasMatchingProfile: boolean;
  applications: WorkQueueApplicationInput[];
  documents: WorkQueueDocumentInput[];
  tasks: WorkQueueTaskInput[];
  deadlines: WorkQueueDeadlineInput[];
  programs: WorkQueueProgramInput[];
  lastStudentMessageAt: Date | null;
  lastCuratorReplyAt: Date | null;
  dismissedSourceKeys: string[];
  accompanimentStatus?: string;
};

export type WorkQueueInput = {
  students: WorkQueueStudentInput[];
  now?: Date;
};
