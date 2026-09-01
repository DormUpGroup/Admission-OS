/**
 * Centralized domain enums (Prisma SQLite stores these as strings).
 */

export const UserRole = {
  ADMIN: "ADMIN",
  CURATOR: "CURATOR",
  STUDENT: "STUDENT",
} as const;
export type UserRole = (typeof UserRole)[keyof typeof UserRole];

export const StudentStatus = {
  ACTIVE: "ACTIVE",
  PAUSED: "PAUSED",
  COMPLETED: "COMPLETED",
  ARCHIVED: "ARCHIVED",
} as const;
export type StudentStatus = (typeof StudentStatus)[keyof typeof StudentStatus];

export const AccompanimentStatus = {
  NONE: "NONE",
  PENDING: "PENDING",
  UNDER_REVIEW: "UNDER_REVIEW",
  ACCEPTED: "ACCEPTED",
  REJECTED: "REJECTED",
} as const;
export type AccompanimentStatus =
  (typeof AccompanimentStatus)[keyof typeof AccompanimentStatus];

export const StudyLevel = {
  BACHELOR: "BACHELOR",
  MASTER: "MASTER",
  SINGLE_CYCLE: "SINGLE_CYCLE",
  FOUNDATION: "FOUNDATION",
  PHD: "PHD",
  OTHER: "OTHER",
} as const;
export type StudyLevel = (typeof StudyLevel)[keyof typeof StudyLevel];

export const JourneyStage = {
  PROFILE: "PROFILE",
  STRATEGY: "STRATEGY",
  PROGRAMS: "PROGRAMS",
  APPLICATIONS: "APPLICATIONS",
  ADMISSION: "ADMISSION",
  ENROLLMENT: "ENROLLMENT",
  COMPLETED: "COMPLETED",
} as const;
export type JourneyStage = (typeof JourneyStage)[keyof typeof JourneyStage];

export const ApplicationStatus = {
  SELECTED: "SELECTED",
  PREPARING: "PREPARING",
  READY_FOR_REVIEW: "READY_FOR_REVIEW",
  READY_TO_SUBMIT: "READY_TO_SUBMIT",
  SUBMITTED: "SUBMITTED",
  WAITING_RESULT: "WAITING_RESULT",
  ADDITIONAL_DOCUMENTS: "ADDITIONAL_DOCUMENTS",
  ADMITTED: "ADMITTED",
  REJECTED: "REJECTED",
  WAITLISTED: "WAITLISTED",
  NOT_SELECTED: "NOT_SELECTED",
  ENROLLED: "ENROLLED",
} as const;
export type ApplicationStatus =
  (typeof ApplicationStatus)[keyof typeof ApplicationStatus];

export const RequirementType = {
  DOCUMENT: "DOCUMENT",
  EXAM: "EXAM",
  LANGUAGE: "LANGUAGE",
  TASK: "TASK",
  PAYMENT: "PAYMENT",
  OTHER: "OTHER",
} as const;
export type RequirementType =
  (typeof RequirementType)[keyof typeof RequirementType];

export const RequirementStatus = {
  MISSING: "MISSING",
  REQUESTED: "REQUESTED",
  UPLOADED: "UPLOADED",
  UNDER_REVIEW: "UNDER_REVIEW",
  COMPLETED: "COMPLETED",
  BLOCKED: "BLOCKED",
  NOT_APPLICABLE: "NOT_APPLICABLE",
} as const;
export type RequirementStatus =
  (typeof RequirementStatus)[keyof typeof RequirementStatus];

export const DocumentCategory = {
  PERSONAL: "PERSONAL",
  EDUCATION: "EDUCATION",
  LANGUAGE: "LANGUAGE",
  EXAMS: "EXAMS",
  OTHER: "OTHER",
} as const;
export type DocumentCategory =
  (typeof DocumentCategory)[keyof typeof DocumentCategory];

export const DocumentStatus = {
  MISSING: "MISSING",
  REQUESTED: "REQUESTED",
  UPLOADED: "UPLOADED",
  UNDER_REVIEW: "UNDER_REVIEW",
  APPROVED: "APPROVED",
  NEEDS_CHANGES: "NEEDS_CHANGES",
  EXPIRED: "EXPIRED",
} as const;
export type DocumentStatus =
  (typeof DocumentStatus)[keyof typeof DocumentStatus];

export const TaskStatus = {
  TODO: "TODO",
  IN_PROGRESS: "IN_PROGRESS",
  WAITING: "WAITING",
  BLOCKED: "BLOCKED",
  DONE: "DONE",
} as const;
export type TaskStatus = (typeof TaskStatus)[keyof typeof TaskStatus];

export const TaskPriority = {
  LOW: "LOW",
  MEDIUM: "MEDIUM",
  HIGH: "HIGH",
  URGENT: "URGENT",
} as const;
export type TaskPriority = (typeof TaskPriority)[keyof typeof TaskPriority];

export const RiskLevel = {
  NONE: "NONE",
  LOW: "LOW",
  MEDIUM: "MEDIUM",
  HIGH: "HIGH",
  CRITICAL: "CRITICAL",
} as const;
export type RiskLevel = (typeof RiskLevel)[keyof typeof RiskLevel];

export const ActivityType = {
  STUDENT_CREATED: "STUDENT_CREATED",
  APPLICATION_CREATED: "APPLICATION_CREATED",
  APPLICATION_STATUS_CHANGED: "APPLICATION_STATUS_CHANGED",
  DOCUMENT_REQUESTED: "DOCUMENT_REQUESTED",
  DOCUMENT_UPLOADED: "DOCUMENT_UPLOADED",
  DOCUMENT_APPROVED: "DOCUMENT_APPROVED",
  DOCUMENT_NEEDS_CHANGES: "DOCUMENT_NEEDS_CHANGES",
  TASK_CREATED: "TASK_CREATED",
  TASK_COMPLETED: "TASK_COMPLETED",
  DEADLINE_CREATED: "DEADLINE_CREATED",
  APPLICATION_SUBMITTED: "APPLICATION_SUBMITTED",
  NOTE: "NOTE",
  PROGRAM_MATCH_GENERATED: "PROGRAM_MATCH_GENERATED",
  PROGRAM_MATCH_REVIEWED: "PROGRAM_MATCH_REVIEWED",
  PROGRAM_SHORTLISTED: "PROGRAM_SHORTLISTED",
  PROGRAM_SOURCE_CHANGED: "PROGRAM_SOURCE_CHANGED",
  QUEUE_ITEM_DISMISSED: "QUEUE_ITEM_DISMISSED",
  ACCOMPANIMENT_ACCEPTED: "ACCOMPANIMENT_ACCEPTED",
  ACCOMPANIMENT_REJECTED: "ACCOMPANIMENT_REJECTED",
  ACCOMPANIMENT_CLARIFICATION_REQUESTED: "ACCOMPANIMENT_CLARIFICATION_REQUESTED",
  INTAKE_LIMIT_CHANGED: "INTAKE_LIMIT_CHANGED",
} as const;
export type ActivityType = (typeof ActivityType)[keyof typeof ActivityType];

export const DeadlineType = {
  HARD: "HARD",
  TARGET: "TARGET",
  DOCUMENT: "DOCUMENT",
  TASK: "TASK",
  OTHER: "OTHER",
} as const;
export type DeadlineType = (typeof DeadlineType)[keyof typeof DeadlineType];
