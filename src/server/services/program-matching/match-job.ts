import type { ProgramMatchJob } from "@prisma/client";
import { prisma } from "@/lib/db";
import {
  enqueueOutbox,
  type DbClient,
} from "@/server/commands/outbox";
import type { MatchProgressEvent } from "@/server/services/program-matching/program-matching";

export const PROGRAMS_MATCH_EVENT = "programs.match";

export const PROGRAM_MATCH_JOB_STATUS = {
  PENDING: "PENDING",
  RUNNING: "RUNNING",
  SUCCEEDED: "SUCCEEDED",
  FAILED: "FAILED",
} as const;

export type ProgramMatchJobStatus =
  (typeof PROGRAM_MATCH_JOB_STATUS)[keyof typeof PROGRAM_MATCH_JOB_STATUS];

const ACTIVE_STATUSES: ProgramMatchJobStatus[] = [
  PROGRAM_MATCH_JOB_STATUS.PENDING,
  PROGRAM_MATCH_JOB_STATUS.RUNNING,
];

export function isActiveProgramMatchJobStatus(
  status: string,
): status is "PENDING" | "RUNNING" {
  return (
    status === PROGRAM_MATCH_JOB_STATUS.PENDING ||
    status === PROGRAM_MATCH_JOB_STATUS.RUNNING
  );
}

export function jobIdFromProgramsMatchPayload(
  payload: unknown,
  fallback?: string,
): string {
  if (payload && typeof payload === "object" && !Array.isArray(payload)) {
    const jobId = (payload as { jobId?: unknown }).jobId;
    if (typeof jobId === "string" && jobId.trim()) return jobId.trim();
  }
  if (fallback?.trim()) return fallback.trim();
  throw new Error("programs.match payload is missing jobId");
}

export type ProgramMatchJobView = {
  id: string;
  studentId: string;
  status: string;
  stage: string | null;
  label: string | null;
  percent: number;
  detail: string | null;
  done: number | null;
  total: number | null;
  error: string | null;
  matchCount: number | null;
  engine: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export function toProgramMatchJobView(job: ProgramMatchJob): ProgramMatchJobView {
  return {
    id: job.id,
    studentId: job.studentId,
    status: job.status,
    stage: job.stage,
    label: job.label,
    percent: job.percent,
    detail: job.detail,
    done: job.done,
    total: job.total,
    error: job.error,
    matchCount: job.matchCount,
    engine: job.engine,
    startedAt: job.startedAt?.toISOString() ?? null,
    finishedAt: job.finishedAt?.toISOString() ?? null,
    createdAt: job.createdAt.toISOString(),
    updatedAt: job.updatedAt.toISOString(),
  };
}

export async function findActiveProgramMatchJob(
  studentId: string,
  db: DbClient = prisma,
): Promise<ProgramMatchJob | null> {
  return db.programMatchJob.findFirst({
    where: {
      studentId,
      status: { in: ACTIVE_STATUSES },
    },
    orderBy: { createdAt: "desc" },
  });
}

export async function findLatestProgramMatchJob(
  studentId: string,
  db: DbClient = prisma,
): Promise<ProgramMatchJob | null> {
  return db.programMatchJob.findFirst({
    where: { studentId },
    orderBy: { createdAt: "desc" },
  });
}

export async function enqueueProgramMatchJob(
  studentId: string,
  db: DbClient = prisma,
): Promise<{ job: ProgramMatchJob; created: boolean }> {
  const active = await findActiveProgramMatchJob(studentId, db);
  if (active) {
    return { job: active, created: false };
  }

  const job = await db.programMatchJob.create({
    data: {
      studentId,
      status: PROGRAM_MATCH_JOB_STATUS.PENDING,
      stage: "profile",
      label: "В очереди на подбор программ…",
      percent: 1,
    },
  });

  const outbox = await enqueueOutbox(db, {
    aggregateType: "student",
    aggregateId: studentId,
    eventType: PROGRAMS_MATCH_EVENT,
    idempotencyKey: `${PROGRAMS_MATCH_EVENT}:${job.id}`,
    payload: { jobId: job.id, studentId },
    maxAttempts: 2,
  });

  const linked = await db.programMatchJob.update({
    where: { id: job.id },
    data: { outboxEventId: outbox.id },
  });

  return { job: linked, created: true };
}

export async function applyProgramMatchJobProgress(
  jobId: string,
  event: MatchProgressEvent,
  db: DbClient = prisma,
): Promise<void> {
  await db.programMatchJob.updateMany({
    where: {
      id: jobId,
      status: {
        in: [PROGRAM_MATCH_JOB_STATUS.PENDING, PROGRAM_MATCH_JOB_STATUS.RUNNING],
      },
    },
    data: {
      stage: event.stage,
      label: event.label,
      percent: event.percent,
      detail: event.detail ?? null,
      done: event.done ?? null,
      total: event.total ?? null,
    },
  });
}
