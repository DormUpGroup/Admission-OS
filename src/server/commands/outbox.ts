import type { OutboxEvent, Prisma, PrismaClient } from "@prisma/client";
import { randomUUID } from "crypto";

export const OUTBOX_STATUS = {
  PENDING: "PENDING",
  PROCESSING: "PROCESSING",
  COMPLETED: "COMPLETED",
  DEAD: "DEAD",
} as const;

export type OutboxStatus = (typeof OUTBOX_STATUS)[keyof typeof OUTBOX_STATUS];

/** Event types that always run (scaffold / diagnostics). */
export const ALWAYS_ALLOWED_EVENT_TYPES = new Set([
  "noop",
  "worker.log",
]);

/**
 * Event types that require AUTOMATION_ENABLED=true.
 * Phase 0 registers none beyond diagnostics; later PRs add telegram/calendar/hermes.
 */
export const AUTOMATION_EVENT_TYPES = new Set<string>([
  "agent.intake",
  "message.received",
  "telegram.send",
  "calendar.upsert",
  "calendar.delete",
  "hermes.create_run",
]);

export const DEFAULT_LEASE_MS = 5 * 60 * 1000;

export type DbClient = PrismaClient | Prisma.TransactionClient;

export type EnqueueOutboxInput = {
  aggregateType: string;
  aggregateId: string;
  eventType: string;
  payload: Prisma.InputJsonValue;
  idempotencyKey: string;
  eventVersion?: number;
  maxAttempts?: number;
  nextAttemptAt?: Date;
};

export function isAutomationEnabled(
  env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env,
): boolean {
  const raw = (env.AUTOMATION_ENABLED ?? "false").trim().toLowerCase();
  return raw === "true" || raw === "1" || raw === "yes";
}

export function isEventTypeAllowed(
  eventType: string,
  env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env,
): boolean {
  if (ALWAYS_ALLOWED_EVENT_TYPES.has(eventType)) return true;
  if (!isAutomationEnabled(env)) return false;
  return true;
}

export function retryDelayMs(attempt: number): number {
  const capped = Math.min(attempt, 11);
  const seconds = Math.min(3600, 2 ** capped);
  const jitter = (attempt * 17) % 13;
  return (seconds + jitter) * 1000;
}

export async function enqueueOutbox(
  db: DbClient,
  input: EnqueueOutboxInput,
): Promise<OutboxEvent> {
  const existing = await db.outboxEvent.findUnique({
    where: { idempotencyKey: input.idempotencyKey },
  });
  if (existing) return existing;

  try {
    return await db.outboxEvent.create({
      data: {
        aggregateType: input.aggregateType,
        aggregateId: input.aggregateId,
        eventType: input.eventType,
        eventVersion: input.eventVersion ?? 1,
        payloadJson: input.payload,
        idempotencyKey: input.idempotencyKey,
        maxAttempts: input.maxAttempts ?? 8,
        nextAttemptAt: input.nextAttemptAt ?? new Date(),
        status: OUTBOX_STATUS.PENDING,
      },
    });
  } catch (error) {
    // Race on unique idempotencyKey — return the winner.
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      (error as { code?: string }).code === "P2002"
    ) {
      const again = await db.outboxEvent.findUnique({
        where: { idempotencyKey: input.idempotencyKey },
      });
      if (again) return again;
    }
    throw error;
  }
}

type ClaimRow = {
  id: string;
  aggregateType: string;
  aggregateId: string;
  eventType: string;
  eventVersion: number;
  payloadJson: Prisma.JsonValue;
  status: string;
  attempts: number;
  maxAttempts: number;
  nextAttemptAt: Date;
  lockedBy: string | null;
  lockedAt: Date | null;
  leaseToken: string | null;
  leaseExpiresAt: Date | null;
  processedAt: Date | null;
  lastError: string | null;
  idempotencyKey: string;
  createdAt: Date;
  updatedAt: Date;
};

/**
 * Atomically claim pending (or expired-lease) outbox rows using
 * FOR UPDATE SKIP LOCKED so concurrent workers never double-claim.
 */
export async function claimOutboxEvents(
  db: DbClient,
  options: {
    workerId: string;
    limit?: number;
    leaseMs?: number;
    now?: Date;
  },
): Promise<OutboxEvent[]> {
  const workerId = options.workerId;
  const limit = options.limit ?? 25;
  const leaseMs = options.leaseMs ?? DEFAULT_LEASE_MS;
  const now = options.now ?? new Date();
  const leaseExpiresAt = new Date(now.getTime() + leaseMs);

  // Select candidate ids under SKIP LOCKED, then stamp lease in the same tx.
  const rows = await db.$queryRaw<ClaimRow[]>`
    WITH candidates AS (
      SELECT id
      FROM "OutboxEvent"
      WHERE
        (
          status = ${OUTBOX_STATUS.PENDING}
          AND "nextAttemptAt" <= ${now}
        )
        OR (
          status = ${OUTBOX_STATUS.PROCESSING}
          AND "leaseExpiresAt" IS NOT NULL
          AND "leaseExpiresAt" < ${now}
        )
        OR (
          status = ${OUTBOX_STATUS.PROCESSING}
          AND "leaseExpiresAt" IS NULL
          AND "lockedAt" IS NOT NULL
          AND "lockedAt" < ${new Date(now.getTime() - leaseMs)}
        )
      ORDER BY "createdAt" ASC
      LIMIT ${limit}
      FOR UPDATE SKIP LOCKED
    )
    UPDATE "OutboxEvent" AS o
    SET
      status = ${OUTBOX_STATUS.PROCESSING},
      "lockedBy" = ${workerId},
      "lockedAt" = ${now},
      "leaseToken" = md5(random()::text || clock_timestamp()::text),
      "leaseExpiresAt" = ${leaseExpiresAt},
      "updatedAt" = ${now}
    FROM candidates
    WHERE o.id = candidates.id
    RETURNING
      o.id,
      o."aggregateType",
      o."aggregateId",
      o."eventType",
      o."eventVersion",
      o."payloadJson",
      o.status,
      o.attempts,
      o."maxAttempts",
      o."nextAttemptAt",
      o."lockedBy",
      o."lockedAt",
      o."leaseToken",
      o."leaseExpiresAt",
      o."processedAt",
      o."lastError",
      o."idempotencyKey",
      o."createdAt",
      o."updatedAt"
  `;

  return rows as OutboxEvent[];
}

export async function renewOutboxLease(
  db: DbClient,
  eventId: string,
  leaseToken: string,
  options?: { extendMs?: number; now?: Date },
): Promise<boolean> {
  const now = options?.now ?? new Date();
  const extendMs = options?.extendMs ?? DEFAULT_LEASE_MS;
  const result = await db.outboxEvent.updateMany({
    where: {
      id: eventId,
      status: OUTBOX_STATUS.PROCESSING,
      leaseToken,
    },
    data: {
      leaseExpiresAt: new Date(now.getTime() + extendMs),
      lockedAt: now,
    },
  });
  return result.count > 0;
}

export async function completeOutboxEvent(
  db: DbClient,
  eventId: string,
  leaseToken: string,
  options?: { now?: Date },
): Promise<boolean> {
  const now = options?.now ?? new Date();
  const result = await db.outboxEvent.updateMany({
    where: {
      id: eventId,
      status: OUTBOX_STATUS.PROCESSING,
      leaseToken,
    },
    data: {
      status: OUTBOX_STATUS.COMPLETED,
      processedAt: now,
      lockedBy: null,
      lockedAt: null,
      leaseToken: null,
      leaseExpiresAt: null,
      lastError: null,
    },
  });
  return result.count > 0;
}

export async function retryOutboxEvent(
  db: DbClient,
  eventId: string,
  leaseToken: string,
  errorMessage: string,
  options?: { now?: Date },
): Promise<"retried" | "dead" | "lost_lease"> {
  const now = options?.now ?? new Date();
  const current = await db.outboxEvent.findFirst({
    where: {
      id: eventId,
      status: OUTBOX_STATUS.PROCESSING,
      leaseToken,
    },
  });
  if (!current) return "lost_lease";

  const attempts = current.attempts + 1;
  if (attempts >= current.maxAttempts) {
    const dead = await db.outboxEvent.updateMany({
      where: {
        id: eventId,
        status: OUTBOX_STATUS.PROCESSING,
        leaseToken,
      },
      data: {
        status: OUTBOX_STATUS.DEAD,
        attempts,
        lastError: errorMessage.slice(0, 4000),
        lockedBy: null,
        lockedAt: null,
        leaseToken: null,
        leaseExpiresAt: null,
      },
    });
    return dead.count > 0 ? "dead" : "lost_lease";
  }

  const nextAttemptAt = new Date(now.getTime() + retryDelayMs(attempts));
  const retried = await db.outboxEvent.updateMany({
    where: {
      id: eventId,
      status: OUTBOX_STATUS.PROCESSING,
      leaseToken,
    },
    data: {
      status: OUTBOX_STATUS.PENDING,
      attempts,
      nextAttemptAt,
      lastError: errorMessage.slice(0, 4000),
      lockedBy: null,
      lockedAt: null,
      leaseToken: null,
      leaseExpiresAt: null,
    },
  });
  return retried.count > 0 ? "retried" : "lost_lease";
}

export async function deadLetterOutboxEvent(
  db: DbClient,
  eventId: string,
  leaseToken: string,
  errorMessage: string,
): Promise<boolean> {
  const result = await db.outboxEvent.updateMany({
    where: {
      id: eventId,
      status: OUTBOX_STATUS.PROCESSING,
      leaseToken,
    },
    data: {
      status: OUTBOX_STATUS.DEAD,
      lastError: errorMessage.slice(0, 4000),
      lockedBy: null,
      lockedAt: null,
      leaseToken: null,
      leaseExpiresAt: null,
    },
  });
  return result.count > 0;
}

/** Convenience: enqueue a diagnostic noop event (idempotent). */
export async function enqueueNoop(
  db: DbClient,
  options?: { idempotencyKey?: string; message?: string },
): Promise<OutboxEvent> {
  const key = options?.idempotencyKey ?? `noop:${randomUUID()}`;
  return enqueueOutbox(db, {
    aggregateType: "Worker",
    aggregateId: "noop",
    eventType: "noop",
    payload: { message: options?.message ?? "noop" },
    idempotencyKey: key,
  });
}

export async function enqueueWorkerLog(
  db: DbClient,
  options: { message: string; idempotencyKey?: string; meta?: Prisma.InputJsonValue },
): Promise<OutboxEvent> {
  const key = options.idempotencyKey ?? `worker.log:${randomUUID()}`;
  return enqueueOutbox(db, {
    aggregateType: "Worker",
    aggregateId: "log",
    eventType: "worker.log",
    payload: {
      message: options.message,
      ...(options.meta && typeof options.meta === "object" && !Array.isArray(options.meta)
        ? { meta: options.meta }
        : {}),
    },
    idempotencyKey: key,
  });
}
