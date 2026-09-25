import { randomUUID } from "crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import {
  claimOutboxEvents,
  completeOutboxEvent,
  enqueueOutbox,
  GLOBAL_AUTOMATION_SETTING_KEY,
  isEventTypeAllowed,
  KILL_SWITCH_DEFER_MS,
  OUTBOX_STATUS,
  deferOutboxForKillSwitch,
  replayDeadOutboxEvent,
  retryOutboxEvent,
  setGlobalAutomationEnabled,
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

  it("replayDeadOutboxEvent resets DEAD to PENDING", async () => {
    const key = `${prefix}:replay-${randomUUID()}`;
    const event = await enqueueOutbox(prisma, {
      aggregateType: "Test",
      aggregateId: "e",
      eventType: "noop",
      payload: {},
      idempotencyKey: key,
      maxAttempts: 1,
    });
    const claimed = (
      await claimOutboxEvents(prisma, {
        workerId: `${prefix}-replay`,
        limit: 25,
      })
    ).find((row) => row.id === event.id);
    expect(claimed?.leaseToken).toBeTruthy();
    const outcome = await retryOutboxEvent(
      prisma,
      claimed!.id,
      claimed!.leaseToken!,
      "fatal",
    );
    expect(outcome).toBe("dead");

    const ok = await replayDeadOutboxEvent(prisma, event.id);
    expect(ok).toBe(true);
    const after = await prisma.outboxEvent.findUniqueOrThrow({
      where: { id: event.id },
    });
    expect(after.status).toBe(OUTBOX_STATUS.PENDING);
    expect(after.attempts).toBe(0);
    expect(after.lastError).toBeNull();
    expect(after.leaseToken).toBeNull();

    const again = await replayDeadOutboxEvent(prisma, event.id);
    expect(again).toBe(false);
  });

  it("deferOutboxForKillSwitch parks without burning attempts", async () => {
    const key = `${prefix}:defer-${randomUUID()}`;
    const event = await enqueueOutbox(prisma, {
      aggregateType: "Test",
      aggregateId: "f",
      eventType: "telegram.send",
      payload: {},
      idempotencyKey: key,
    });
    const claimed = (
      await claimOutboxEvents(prisma, {
        workerId: `${prefix}-defer`,
        limit: 25,
      })
    ).find((row) => row.id === event.id);
    expect(claimed?.leaseToken).toBeTruthy();
    expect(claimed!.attempts).toBe(0);

    const now = new Date("2026-09-25T10:00:00.000Z");
    const ok = await deferOutboxForKillSwitch(
      prisma,
      claimed!.id,
      claimed!.leaseToken!,
      `Event type "${claimed!.eventType}" blocked by automation kill-switch`,
      { now },
    );
    expect(ok).toBe(true);

    const after = await prisma.outboxEvent.findUniqueOrThrow({
      where: { id: event.id },
    });
    expect(after.status).toBe(OUTBOX_STATUS.PENDING);
    expect(after.attempts).toBe(0);
    expect(after.leaseToken).toBeNull();
    expect(after.lockedBy).toBeNull();
    expect(after.nextAttemptAt.toISOString()).toBe(
      new Date(now.getTime() + KILL_SWITCH_DEFER_MS).toISOString(),
    );
    expect(after.lastError).toContain("blocked by automation kill-switch");

    // Lost lease / wrong token → no-op
    const lost = await deferOutboxForKillSwitch(
      prisma,
      event.id,
      "not-the-lease",
      "should not apply",
      { now },
    );
    expect(lost).toBe(false);
  });
});

describe("automation kill-switch resolve (unit)", () => {
  it("resolveAutomationEnabled is env AND db (missing row = false)", async () => {
    const { resolveAutomationEnabled } = await import("@/server/commands/outbox");

    const missingRow = {
      automationSetting: {
        findUnique: async () => null,
      },
    } as unknown as import("@/server/commands/outbox").DbClient;

    expect(
      await resolveAutomationEnabled(missingRow, { AUTOMATION_ENABLED: "true" }),
    ).toBe(false);
    expect(
      await resolveAutomationEnabled(missingRow, { AUTOMATION_ENABLED: "false" }),
    ).toBe(false);

    const enabledRow = {
      automationSetting: {
        findUnique: async () => ({
          key: "global_enabled",
          valueJson: { enabled: true },
        }),
      },
    } as unknown as import("@/server/commands/outbox").DbClient;

    expect(
      await resolveAutomationEnabled(enabledRow, { AUTOMATION_ENABLED: "true" }),
    ).toBe(true);
    expect(
      await resolveAutomationEnabled(enabledRow, { AUTOMATION_ENABLED: "false" }),
    ).toBe(false);

    const disabledRow = {
      automationSetting: {
        findUnique: async () => ({
          key: "global_enabled",
          valueJson: { enabled: false },
        }),
      },
    } as unknown as import("@/server/commands/outbox").DbClient;

    expect(
      await resolveAutomationEnabled(disabledRow, { AUTOMATION_ENABLED: "true" }),
    ).toBe(false);
  });
});

describeDb("automation setting upsert (db)", () => {
  const prisma = new PrismaClient();
  const actorId = `test-actor-${randomUUID()}`;
  let previous: { valueJson: unknown; description: string | null } | null = null;

  beforeAll(async () => {
    const row = await prisma.automationSetting.findUnique({
      where: { key: GLOBAL_AUTOMATION_SETTING_KEY },
    });
    previous = row
      ? { valueJson: row.valueJson, description: row.description }
      : null;
  });

  afterAll(async () => {
    if (previous) {
      await prisma.automationSetting.upsert({
        where: { key: GLOBAL_AUTOMATION_SETTING_KEY },
        create: {
          key: GLOBAL_AUTOMATION_SETTING_KEY,
          valueJson: previous.valueJson as object,
          description: previous.description,
        },
        update: {
          valueJson: previous.valueJson as object,
          description: previous.description,
        },
      });
    }
    // If there was no prior row, leave whatever the suite wrote — do not delete
    // (other parallel test files may rely on global_enabled existing).
    await prisma.$disconnect();
  });

  it("setGlobalAutomationEnabled upserts global_enabled", async () => {
    const value = await setGlobalAutomationEnabled(prisma, {
      enabled: true,
      actorId,
      reason: "upsert-test",
    });
    expect(value.enabled).toBe(true);
    const row = await prisma.automationSetting.findUniqueOrThrow({
      where: { key: GLOBAL_AUTOMATION_SETTING_KEY },
    });
    expect(parseGlobalEnabledForTest(row.valueJson)).toBe(true);
  });
});

function parseGlobalEnabledForTest(valueJson: unknown): boolean {
  if (!valueJson || typeof valueJson !== "object" || Array.isArray(valueJson)) {
    return false;
  }
  return (valueJson as { enabled?: unknown }).enabled === true;
}

describe("outbox helpers (unit)", () => {
  it("isEventTypeAllowed respects kill-switch for automation types", () => {
    expect(isEventTypeAllowed("noop", false)).toBe(true);
    expect(isEventTypeAllowed("telegram.send", false)).toBe(false);
    expect(isEventTypeAllowed("telegram.send", true)).toBe(true);
  });
});
