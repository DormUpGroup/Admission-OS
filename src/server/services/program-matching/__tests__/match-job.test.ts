import { randomUUID } from "crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { ALWAYS_ALLOWED_EVENT_TYPES, isEventTypeAllowed } from "@/server/commands/outbox";
import {
  enqueueProgramMatchJob,
  findActiveProgramMatchJob,
  isActiveProgramMatchJobStatus,
  jobIdFromProgramsMatchPayload,
  PROGRAM_MATCH_JOB_STATUS,
  PROGRAMS_MATCH_EVENT,
  toProgramMatchJobView,
} from "@/server/services/program-matching/match-job";

describe("program match job helpers", () => {
  it("treats PENDING and RUNNING as active", () => {
    expect(isActiveProgramMatchJobStatus("PENDING")).toBe(true);
    expect(isActiveProgramMatchJobStatus("RUNNING")).toBe(true);
    expect(isActiveProgramMatchJobStatus("SUCCEEDED")).toBe(false);
    expect(isActiveProgramMatchJobStatus("FAILED")).toBe(false);
  });

  it("reads jobId from programs.match payload", () => {
    expect(jobIdFromProgramsMatchPayload({ jobId: "job_1" })).toBe("job_1");
    expect(jobIdFromProgramsMatchPayload({}, "fallback")).toBe("fallback");
    expect(() => jobIdFromProgramsMatchPayload(null)).toThrow(/jobId/);
  });

  it("allows programs.match when automation is off", () => {
    expect(ALWAYS_ALLOWED_EVENT_TYPES.has(PROGRAMS_MATCH_EVENT)).toBe(true);
    expect(isEventTypeAllowed(PROGRAMS_MATCH_EVENT, false)).toBe(true);
  });
});

const hasDatabase = Boolean(process.env.DATABASE_URL?.trim());
const describeDb = hasDatabase ? describe : describe.skip;

describeDb("enqueueProgramMatchJob", () => {
  const prisma = new PrismaClient();
  const prefix = `match-job-${randomUUID().slice(0, 8)}`;
  let studentId = "";

  beforeAll(async () => {
    await prisma.$queryRaw`SELECT 1 FROM "ProgramMatchJob" LIMIT 1`;
    const student = await prisma.student.create({
      data: {
        firstName: prefix,
        lastName: "MatchJob",
        email: `${prefix}@example.test`,
        intake: "2026/27",
        studyLevel: "BACHELOR",
      },
    });
    studentId = student.id;
  });

  afterAll(async () => {
    if (studentId) {
      await prisma.programMatchJob.deleteMany({ where: { studentId } });
      await prisma.outboxEvent.deleteMany({
        where: {
          eventType: PROGRAMS_MATCH_EVENT,
          aggregateId: studentId,
        },
      });
      await prisma.student.delete({ where: { id: studentId } }).catch(() => undefined);
    }
    await prisma.$disconnect();
  });

  it("creates a PENDING job and outbox event once", async () => {
    const first = await enqueueProgramMatchJob(studentId);
    expect(first.created).toBe(true);
    expect(first.job.status).toBe(PROGRAM_MATCH_JOB_STATUS.PENDING);
    expect(first.job.outboxEventId).toBeTruthy();

    const second = await enqueueProgramMatchJob(studentId);
    expect(second.created).toBe(false);
    expect(second.job.id).toBe(first.job.id);

    const active = await findActiveProgramMatchJob(studentId);
    expect(active?.id).toBe(first.job.id);

    const view = toProgramMatchJobView(first.job);
    expect(view.id).toBe(first.job.id);
    expect(view.studentId).toBe(studentId);
    expect(view.status).toBe("PENDING");
  });
});
