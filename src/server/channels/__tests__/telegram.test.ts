import { createHash, randomUUID } from "crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import {
  hashJson,
  normalizeTelegramUpdate,
} from "@/server/channels/telegram";
import { ingestTelegramUpdate } from "@/server/commands/telegram-inbound";
import {
  DELIVERY_STATUS,
  isAmbiguousTelegramError,
  prepareTelegramDelivery,
} from "@/server/delivery/telegram";
import { enqueueOutbox, OUTBOX_STATUS } from "@/server/commands/outbox";

describe("telegram normalize (unit)", () => {
  it("normalizes a text message update", () => {
    const normalized = normalizeTelegramUpdate({
      update_id: 42,
      message: {
        message_id: 7,
        text: "ciao",
        from: { id: 100, first_name: "Ada", last_name: "Lovelace", username: "ada" },
        chat: { id: 100, type: "private" },
      },
    });
    expect(normalized).toEqual({
      providerEventId: "42",
      providerMessageId: "7",
      externalUserId: "100",
      externalChatId: "100",
      username: "ada",
      displayName: "Ada Lovelace",
      text: "ciao",
      attachments: [],
    });
  });

  it("returns null for non-message updates", () => {
    expect(normalizeTelegramUpdate({ update_id: 1 })).toBeNull();
  });

  it("hashJson is stable across key order", () => {
    expect(hashJson({ b: 1, a: 2 })).toBe(hashJson({ a: 2, b: 1 }));
  });

  it("maps ambiguous transport errors", () => {
    const abort = new Error("aborted");
    abort.name = "AbortError";
    expect(isAmbiguousTelegramError(abort)).toBe(true);

    const client = Object.assign(new Error("bad request"), { status: 400 });
    expect(isAmbiguousTelegramError(client)).toBe(false);

    const server = Object.assign(new Error("boom"), { status: 502 });
    expect(isAmbiguousTelegramError(server)).toBe(true);
  });
});

const hasDatabase = Boolean(process.env.DATABASE_URL?.trim());
const describeDb = hasDatabase ? describe : describe.skip;

describeDb("telegram ingest + prepare (db)", () => {
  const prisma = new PrismaClient();
  const prefix = `tg-test-${randomUUID()}`;

  beforeAll(async () => {
    await prisma.$queryRaw`SELECT 1 FROM "InboxEvent" LIMIT 1`;
  });

  afterAll(async () => {
    await prisma.inboxEvent.deleteMany({
      where: { providerEventId: { startsWith: prefix } },
    });
    await prisma.$disconnect();
  });

  it("duplicate webhook does not create a second message", async () => {
    const updateId = `${prefix}-${Date.now()}`;
    const payload = {
      update_id: updateId,
      message: {
        message_id: 9001,
        text: "hello-dedupe",
        from: { id: 555001, first_name: "Test", username: "tgtest" },
        chat: { id: 555001, type: "private" },
      },
    };
    const message = normalizeTelegramUpdate(payload);
    expect(message).not.toBeNull();

    const first = await ingestTelegramUpdate({
      rawPayload: payload,
      message: message!,
    });
    expect(first.duplicate).toBe(false);
    if (first.duplicate) return;

    const second = await ingestTelegramUpdate({
      rawPayload: payload,
      message: message!,
    });
    expect(second.duplicate).toBe(true);

    const count = await prisma.conversationMessage.count({
      where: {
        conversationId: first.conversationId,
        providerMessageId: "9001",
      },
    });
    expect(count).toBe(1);

    const outboxCount = await prisma.outboxEvent.count({
      where: { idempotencyKey: `telegram:update:${updateId}` },
    });
    expect(outboxCount).toBe(1);
  });

  it("prepare does not create a second attempt when UNKNOWN_REQUIRES_REVIEW exists", async () => {
    const updateId = `${prefix}-unk-${Date.now()}`;
    const payload = {
      update_id: updateId,
      message: {
        message_id: 9002,
        text: "need-reply",
        from: { id: 555002, first_name: "Unk", username: "tgunk" },
        chat: { id: 555002, type: "private" },
      },
    };
    const inbound = normalizeTelegramUpdate(payload)!;
    const ingested = await ingestTelegramUpdate({
      rawPayload: payload,
      message: inbound,
    });
    expect(ingested.duplicate).toBe(false);
    if (ingested.duplicate) return;

    const outbound = await prisma.conversationMessage.create({
      data: {
        conversationId: ingested.conversationId,
        direction: "OUTBOUND",
        senderType: "STAFF",
        body: "reply",
        deliveryStatus: DELIVERY_STATUS.UNKNOWN_REQUIRES_REVIEW,
        policyStatus: "APPROVED",
        clientRequestId: `${prefix}-out-${randomUUID()}`,
      },
    });

    await prisma.deliveryAttempt.create({
      data: {
        messageId: outbound.id,
        provider: "TELEGRAM",
        attempt: 1,
        status: DELIVERY_STATUS.UNKNOWN_REQUIRES_REVIEW,
        errorCode: "TEST",
        errorMessage: "seeded unknown",
      },
    });

    const event = await enqueueOutbox(prisma, {
      aggregateType: "ConversationMessage",
      aggregateId: outbound.id,
      eventType: "telegram.send",
      payload: {
        messageId: outbound.id,
        conversationId: ingested.conversationId,
      },
      idempotencyKey: `telegram.send:${outbound.id}`,
    });

    // Mark as PROCESSING so prepare path mirrors worker claim state.
    await prisma.outboxEvent.update({
      where: { id: event.id },
      data: {
        status: OUTBOX_STATUS.PROCESSING,
        leaseToken: createHash("sha256").update(outbound.id).digest("hex").slice(0, 32),
      },
    });

    const prepared = await prepareTelegramDelivery(
      await prisma.outboxEvent.findUniqueOrThrow({ where: { id: event.id } }),
    );
    expect(prepared.action).toBe("skip_unknown");

    const attempts = await prisma.deliveryAttempt.count({
      where: { messageId: outbound.id, provider: "TELEGRAM" },
    });
    expect(attempts).toBe(1);
  });
});
