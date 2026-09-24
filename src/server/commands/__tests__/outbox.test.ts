import { randomUUID } from "crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import {
  claimOutboxEvents,
  completeOutboxEvent,
  enqueueOutbox,
  OUTBOX_STATUS,
  retryOutboxEvent,
} from "@/server/commands/outbox";

const hasDatabase = Boolean(process.env.DATABASE_URL?.trim());

const describeDb = hasDatabase ? describe : describe.skip;

describeDb("outbox enqueue + claim", () => {
  const prisma = new PrismaClient();
  const prefix = `test-outbox-${randomUUID()}`;

  beforeAll(async () => {
    // Ensure table exists (migrate/push already applied in CI/local).
    await prisma.$queryRaw`SELECT 1 FROM "OutboxEvent" LIMIT 1`;
  });

  afterAll(async () => {
    await prisma.outboxEvent.deleteMany({
      where: { idempotencyKey: { startsWith: prefix } },
    });
    await prisma.$disconnect();
  });

  it("enqueue is idempotent on idempotencyKey", async () => {
    const key = `${prefix}:idem-${randomUUID()}`;
    const first = await enqueueOutbox(prisma, {
      aggregateType: "Test",
      aggregateId: "a",
      eventType: "noop",
      payload: { n: 1 },
      idempotencyKey: key,
    });
    const second = await enqueueOutbox(prisma, {
      aggregateType: "Test",
      aggregateId: "a",
      eventType: "noop",
      payload: { n: 2 },
      idempotencyKey: key,
    });

    expect(second.id).toBe(first.id);
    expect(second.payloadJson).toEqual({ n: 1 });

    const count = await prisma.outboxEvent.count({
      where: { idempotencyKey: key },
    });
    expect(count).toBe(1);
  });

  it("parallel claim does not duplicate the same event", async () => {
    const key = `${prefix}:claim-${randomUUID()}`;
    const event = await enqueueOutbox(prisma, {
      aggregateType: "Test",
      aggregateId: "b",
      eventType: "noop",
      payload: { msg: "claim-race" },
      idempotencyKey: key,
    });

    const [a, b] = await Promise.all([
      claimOutboxEvents(prisma, { workerId: `${prefix}-w1`, limit: 10 }),
      claimOutboxEvents(prisma, { workerId: `${prefix}-w2`, limit: 10 }),
    ]);

    const claimedIds = [...a, ...b].map((row) => row.id);
    const hits = claimedIds.filter((id) => id === event.id);
    expect(hits).toHaveLength(1);

    const refreshed = await prisma.outboxEvent.findUniqueOrThrow({
      where: { id: event.id },
    });
    expect(refreshed.status).toBe(OUTBOX_STATUS.PROCESSING);
    expect(refreshed.leaseToken).toBeTruthy();
    expect(refreshed.lockedBy).toMatch(new RegExp(`^${prefix}-w`));
  });

  it("complete and retry update status correctly", async () => {
    const completeKey = `${prefix}:complete-${randomUUID()}`;
    const retryKey = `${prefix}:retry-${randomUUID()}`;

    const toComplete = await enqueueOutbox(prisma, {
      aggregateType: "Test",
      aggregateId: "c",
      eventType: "noop",
      payload: {},
      idempotencyKey: completeKey,
    });
    const [claimedComplete] = await claimOutboxEvents(prisma, {
      workerId: `${prefix}-complete`,
      limit: 5,
    });
    expect(claimedComplete?.id).toBe(toComplete.id);
    expect(claimedComplete.leaseToken).toBeTruthy();

    const completed = await completeOutboxEvent(
      prisma,
      claimedComplete.id,
      claimedComplete.leaseToken!,
    );
    expect(completed).toBe(true);
    const afterComplete = await prisma.outboxEvent.findUniqueOrThrow({
      where: { id: toComplete.id },
    });
    expect(afterComplete.status).toBe(OUTBOX_STATUS.COMPLETED);
    expect(afterComplete.leaseToken).toBeNull();

    const toRetry = await enqueueOutbox(prisma, {
      aggregateType: "Test",
      aggregateId: "d",
      eventType: "noop",
      payload: {},
      idempotencyKey: retryKey,
      maxAttempts: 8,
    });
    const claimedRetry = (
      await claimOutboxEvents(prisma, {
        workerId: `${prefix}-retry`,
        limit: 5,
      })
    ).find((row) => row.id === toRetry.id);
    expect(claimedRetry?.leaseToken).toBeTruthy();

    const outcome = await retryOutboxEvent(
      prisma,
      claimedRetry!.id,
      claimedRetry!.leaseToken!,
      "boom",
    );
    expect(outcome).toBe("retried");
    const afterRetry = await prisma.outboxEvent.findUniqueOrThrow({
      where: { id: toRetry.id },
    });
    expect(afterRetry.status).toBe(OUTBOX_STATUS.PENDING);
    expect(afterRetry.attempts).toBe(1);
    expect(afterRetry.lastError).toBe("boom");
    expect(afterRetry.leaseToken).toBeNull();
  });
});

describe("outbox helpers (unit)", () => {
  it("isEventTypeAllowed respects kill-switch for automation types", async () => {
    const { isEventTypeAllowed } = await import("@/server/commands/outbox");
    expect(isEventTypeAllowed("noop", { AUTOMATION_ENABLED: "false" })).toBe(
      true,
    );
    expect(
      isEventTypeAllowed("telegram.send", { AUTOMATION_ENABLED: "false" }),
    ).toBe(false);
    expect(
      isEventTypeAllowed("telegram.send", { AUTOMATION_ENABLED: "true" }),
    ).toBe(true);
  });
});
