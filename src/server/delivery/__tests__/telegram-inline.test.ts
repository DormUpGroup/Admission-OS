import { randomUUID } from "crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@prisma/client";
import { requestTelegramSend } from "@/server/commands/telegram-outbound";
import { tryDeliverTelegramSendNow } from "@/server/delivery/telegram-inline";
import { OUTBOX_STATUS } from "@/server/commands/outbox";

const hasDatabase = Boolean(process.env.DATABASE_URL?.trim());
const describeDb = hasDatabase ? describe : describe.skip;

describeDb("telegram inline deliver (db)", () => {
  const prisma = new PrismaClient();
  const prefix = `tg-inline-${randomUUID()}`;
  let conversationId = "";

  beforeAll(async () => {
    await prisma.$queryRaw`SELECT 1 FROM "OutboxEvent" LIMIT 1`;
    const lead = await prisma.lead.create({
      data: {
        firstName: "Inline",
        lastName: "Test",
        status: "NEW",
        source: "TELEGRAM",
        consentStatus: "UNKNOWN",
      },
    });
    await prisma.channelIdentity.create({
      data: {
        channel: "TELEGRAM",
        externalId: `${prefix}-user`,
        username: "inlinetest",
        displayName: "Inline Test",
        leadId: lead.id,
        metadataJson: { chat_id: "999001" },
      },
    });
    const conversation = await prisma.conversation.create({
      data: {
        channel: "TELEGRAM",
        status: "OPEN",
        leadId: lead.id,
      },
    });
    conversationId = conversation.id;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  afterAll(async () => {
    if (conversationId) {
      const messages = await prisma.conversationMessage.findMany({
        where: { conversationId },
        select: { id: true },
      });
      const ids = messages.map((m) => m.id);
      if (ids.length > 0) {
        await prisma.deliveryAttempt.deleteMany({
          where: { messageId: { in: ids } },
        });
        await prisma.outboxEvent.deleteMany({
          where: {
            OR: [
              { aggregateId: { in: ids } },
              {
                idempotencyKey: {
                  in: ids.map((id) => `telegram.send:${id}`),
                },
              },
            ],
          },
        });
        await prisma.conversationMessage.deleteMany({
          where: { conversationId },
        });
      }
      await prisma.conversation.delete({ where: { id: conversationId } }).catch(() => undefined);
    }
    await prisma.$disconnect();
  });

  it("skips inline deliver when AUTOMATION_ENABLED=false and leaves PENDING", async () => {
    const prev = process.env.AUTOMATION_ENABLED;
    process.env.AUTOMATION_ENABLED = "false";
    try {
      const { message } = await requestTelegramSend({
        conversationId,
        body: "hold for worker",
        clientRequestId: `${prefix}-off-${Date.now()}`,
      });
      const result = await tryDeliverTelegramSendNow(message.id);
      expect(result).toEqual({ status: "skipped", reason: "automation_off" });

      const refreshed = await prisma.conversationMessage.findUniqueOrThrow({
        where: { id: message.id },
      });
      expect(refreshed.deliveryStatus).toBe("PENDING");

      const outbox = await prisma.outboxEvent.findUniqueOrThrow({
        where: { idempotencyKey: `telegram.send:${message.id}` },
      });
      expect(outbox.status).toBe(OUTBOX_STATUS.PENDING);
    } finally {
      if (prev === undefined) delete process.env.AUTOMATION_ENABLED;
      else process.env.AUTOMATION_ENABLED = prev;
    }
  });

  it("delivers SENT and completes outbox when automation is on", async () => {
    const prevAuto = process.env.AUTOMATION_ENABLED;
    const prevToken = process.env.TELEGRAM_BOT_TOKEN;
    process.env.AUTOMATION_ENABLED = "true";
    process.env.TELEGRAM_BOT_TOKEN = "test-token-inline";

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => ({
          ok: true,
          result: { message_id: 4242 },
        }),
      })),
    );

    try {
      const { message } = await requestTelegramSend({
        conversationId,
        body: "hello inline",
        clientRequestId: `${prefix}-on-${Date.now()}`,
      });

      const result = await tryDeliverTelegramSendNow(message.id);
      expect(result).toEqual({ status: "delivered" });

      const refreshed = await prisma.conversationMessage.findUniqueOrThrow({
        where: { id: message.id },
      });
      expect(refreshed.deliveryStatus).toBe("SENT");
      expect(refreshed.providerMessageId).toBe("4242");

      const outbox = await prisma.outboxEvent.findUniqueOrThrow({
        where: { idempotencyKey: `telegram.send:${message.id}` },
      });
      expect(outbox.status).toBe(OUTBOX_STATUS.COMPLETED);
    } finally {
      if (prevAuto === undefined) delete process.env.AUTOMATION_ENABLED;
      else process.env.AUTOMATION_ENABLED = prevAuto;
      if (prevToken === undefined) delete process.env.TELEGRAM_BOT_TOKEN;
      else process.env.TELEGRAM_BOT_TOKEN = prevToken;
    }
  });
});
