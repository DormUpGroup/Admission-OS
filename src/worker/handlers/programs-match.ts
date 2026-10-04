import { MATCHING_ENGINE_VERSION } from "@/lib/program-matching/config";
import {
  OutboxTerminalError,
  renewOutboxLease,
  type DbClient,
} from "@/server/commands/outbox";
import {
  applyProgramMatchJobProgress,
  jobIdFromProgramsMatchPayload,
  PROGRAM_MATCH_JOB_STATUS,
} from "@/server/services/program-matching/match-job";
import { persistProgramMatches } from "@/server/services/program-matching/program-matching";
import type { OutboxHandler } from "../dispatch";

/** Long matching runs need a lease well above the default 5 minutes. */
export const PROGRAMS_MATCH_LEASE_MS = 15 * 60 * 1000;

const LEASE_RENEW_EVERY_MS = 60_000;

export const handleProgramsMatch: OutboxHandler = async (db, event) => {
  const jobId = jobIdFromProgramsMatchPayload(event.payloadJson, event.aggregateId);
  const leaseToken = event.leaseToken;
  if (!leaseToken) {
    throw new OutboxTerminalError("programs.match event has no leaseToken");
  }

  const job = await db.programMatchJob.findUnique({ where: { id: jobId } });
  if (!job) {
    throw new OutboxTerminalError(`ProgramMatchJob ${jobId} was not found`);
  }
  if (
    job.status === PROGRAM_MATCH_JOB_STATUS.SUCCEEDED ||
    job.status === PROGRAM_MATCH_JOB_STATUS.FAILED
  ) {
    return;
  }

  const startedAt = job.startedAt ?? new Date();
  await db.programMatchJob.update({
    where: { id: jobId },
    data: {
      status: PROGRAM_MATCH_JOB_STATUS.RUNNING,
      startedAt,
      label: job.label ?? "Подбор программ…",
      error: null,
    },
  });

  await renewOutboxLease(db, event.id, leaseToken, {
    extendMs: PROGRAMS_MATCH_LEASE_MS,
  });

  let lastRenewAt = Date.now();
  const renewIfNeeded = async () => {
    const now = Date.now();
    if (now - lastRenewAt < LEASE_RENEW_EVERY_MS) return;
    const ok = await renewOutboxLease(db, event.id, leaseToken, {
      extendMs: PROGRAMS_MATCH_LEASE_MS,
    });
    if (!ok) {
      throw new OutboxTerminalError(
        "Lost outbox lease while programme matching was still running",
      );
    }
    lastRenewAt = now;
  };

  try {
    // persistProgramMatches calls onProgress synchronously; serialize DB writes.
    let progressChain: Promise<void> = Promise.resolve();
    const result = await persistProgramMatches(job.studentId, {
      onProgress: (progress) => {
        progressChain = progressChain
          .then(() => applyProgramMatchJobProgress(jobId, progress, db))
          .then(() => renewIfNeeded());
      },
    });
    await progressChain;

    await db.programMatchJob.update({
      where: { id: jobId },
      data: {
        status: PROGRAM_MATCH_JOB_STATUS.SUCCEEDED,
        stage: "done",
        label: `Готово: ${result.matches.length} программ`,
        percent: 100,
        detail: `движок ${MATCHING_ENGINE_VERSION}`,
        matchCount: result.matches.length,
        engine: MATCHING_ENGINE_VERSION,
        error: null,
        finishedAt: new Date(),
      },
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Programme matching failed";
    await db.programMatchJob.updateMany({
      where: {
        id: jobId,
        status: {
          in: [
            PROGRAM_MATCH_JOB_STATUS.PENDING,
            PROGRAM_MATCH_JOB_STATUS.RUNNING,
          ],
        },
      },
      data: {
        status: PROGRAM_MATCH_JOB_STATUS.FAILED,
        error: message.slice(0, 1000),
        finishedAt: new Date(),
      },
    });
    throw new OutboxTerminalError(message);
  }
};

/** Narrow helper for unit tests that need a typed DbClient. */
export type ProgramsMatchDb = DbClient;
