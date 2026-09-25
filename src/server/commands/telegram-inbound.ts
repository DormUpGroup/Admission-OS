import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import {
  hashJson,
  type NormalizedTelegramMessage,
} from "@/server/channels/telegram";
import {
  parseTelegramBotCommand,
  TELEGRAM_HELP_TEXT,
  TELEGRAM_WELCOME_TEXT,
} from "@/server/channels/telegram-copy";
import { enqueueOutbox, resolveAutomationEnabled } from "@/server/commands/outbox";
import { requestTelegramSend } from "@/server/commands/telegram-outbound";

const CHANNEL = "TELEGRAM";

export type IngestTelegramResult =
  | {
      duplicate: true;
      inboxEventId: string;
    }
  | {
      duplicate: false;
      inboxEventId: string;
      conversationId: string;
      messageId: string;
      leadId: string | null;
      studentId: string | null;
      outboxEventId: string;
      /** Bot replies created in this update. Deliver after the transaction commits. */
      outboundMessageIds: string[];
    };

export async function ingestTelegramUpdate(input: {
  rawPayload: unknown;
  message: NormalizedTelegramMessage;
}): Promise<IngestTelegramResult> {
  const { rawPayload, message } = input;
  const now = new Date();

  return prisma.$transaction(async (tx) => {
    const existingInbox = await tx.inboxEvent.findUnique({
      where: {
        provider_providerEventId: {
          provider: CHANNEL,
          providerEventId: message.providerEventId,
        },
      },
    });
    if (existingInbox) {
      return {
        duplicate: true as const,
        inboxEventId: existingInbox.id,
      };
    }

    const inbox = await tx.inboxEvent.create({
      data: {
        provider: CHANNEL,
        providerEventId: message.providerEventId,
        payloadHash: hashJson(rawPayload),
        payloadJson: rawPayload as Prisma.InputJsonValue,
        status: "PROCESSING",
        receivedAt: now,
      },
    });

    let identity = await tx.channelIdentity.findUnique({
      where: {
        channel_externalId: {
          channel: CHANNEL,
          externalId: message.externalUserId,
        },
      },
    });

    let leadId: string | null = null;
    let studentId: string | null = null;

    if (!identity) {
      const nameParts = (message.displayName ?? "").split(/\s+/).filter(Boolean);
      const lead = await tx.lead.create({
        data: {
          firstName: nameParts[0] ?? null,
          lastName: nameParts.length > 1 ? nameParts.slice(1).join(" ") : null,
          status: "NEW",
          source: CHANNEL,
          consentStatus: "UNKNOWN",
        },
      });
      leadId = lead.id;
      identity = await tx.channelIdentity.create({
        data: {
          channel: CHANNEL,
          externalId: message.externalUserId,
          username: message.username,
          displayName: message.displayName,
          leadId,
          metadataJson: { chat_id: message.externalChatId },
        },
      });
    } else {
      leadId = identity.leadId;
      studentId = identity.studentId;
      identity = await tx.channelIdentity.update({
        where: { id: identity.id },
        data: {
          username: message.username,
          displayName: message.displayName,
          metadataJson: { chat_id: message.externalChatId },
        },
      });
    }

    let conversation = await tx.conversation.findFirst({
      where: {
        channel: CHANNEL,
        status: "OPEN",
        ...(leadId ? { leadId } : { studentId: studentId! }),
      },
      orderBy: { createdAt: "desc" },
    });

    if (!conversation) {
      conversation = await tx.conversation.create({
        data: {
          channel: CHANNEL,
          status: "OPEN",
          leadId,
          studentId,
          lastInboundAt: now,
        },
      });
    } else {
      conversation = await tx.conversation.update({
        where: { id: conversation.id },
        data: { lastInboundAt: now },
      });
    }

    const existingMessage = await tx.conversationMessage.findFirst({
      where: {
        conversationId: conversation.id,
        providerMessageId: message.providerMessageId,
      },
    });

    let messageId: string;
    let createdInbound = false;
    if (existingMessage) {
      messageId = existingMessage.id;
    } else {
      const created = await tx.conversationMessage.create({
        data: {
          conversationId: conversation.id,
          providerMessageId: message.providerMessageId,
          direction: "INBOUND",
          senderType: "CONTACT",
          body: message.text || null,
          attachmentsJson:
            message.attachments.length > 0
              ? (message.attachments as unknown as Prisma.InputJsonValue)
              : undefined,
          deliveryStatus: "RECEIVED",
          policyStatus: "PENDING",
        },
      });
      messageId = created.id;
      createdInbound = true;
    }

    const outboundMessageIds: string[] = [];
    const outbox = await enqueueOutbox(tx, {
      aggregateType: "ConversationMessage",
      aggregateId: messageId,
      eventType: "message.received",
      payload: {
        messageId,
        conversationId: conversation.id,
        channel: CHANNEL,
        providerEventId: message.providerEventId,
      },
      idempotencyKey: `telegram:update:${message.providerEventId}`,
    });

    if (createdInbound && (await resolveAutomationEnabled(tx))) {
      const command = parseTelegramBotCommand(message.text);

      if (command === "help") {
        const sent = await requestTelegramSend({
          tx,
          conversationId: conversation.id,
          body: TELEGRAM_HELP_TEXT,
          clientRequestId: `telegram:help:${message.providerEventId}`,
        });
        outboundMessageIds.push(sent.message.id);
      } else {
        const inboundCount = await tx.conversationMessage.count({
          where: {
            conversationId: conversation.id,
            direction: "INBOUND",
          },
        });
        const shouldWelcome = command === "start" || inboundCount === 1;
        if (shouldWelcome) {
          const sent = await requestTelegramSend({
            tx,
            conversationId: conversation.id,
            body: TELEGRAM_WELCOME_TEXT,
            clientRequestId: `telegram:welcome:${conversation.id}`,
          });
          outboundMessageIds.push(sent.message.id);
        }
      }
    }

    await tx.inboxEvent.update({
      where: { id: inbox.id },
      data: { status: "PROCESSED", processedAt: now },
    });

    return {
      duplicate: false as const,
      inboxEventId: inbox.id,
      conversationId: conversation.id,
      messageId,
      leadId,
      studentId,
      outboxEventId: outbox.id,
      outboundMessageIds,
    };
  });
}
