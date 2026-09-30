import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import {
  hashJson,
  jsonHasBlockedMedia,
  messageHasBlockedMedia,
  type NormalizedTelegramMessage,
} from "@/server/channels/telegram";
import {
  explicitTelegramLeadName,
  isSameConsecutiveCommand,
  isTelegramPriceCommand,
  parseTelegramBotCommand,
  TELEGRAM_HELP_TEXT,
  TELEGRAM_MEDIA_REFUSAL_TEXT,
  TELEGRAM_PRICES_TEXT,
  telegramWelcomeText,
} from "@/server/channels/telegram-copy";
import { confirmAppointmentFromChat } from "@/server/commands/appointments";
import { enqueueOutbox, resolveAutomationEnabled } from "@/server/commands/outbox";
import { requestTelegramSend } from "@/server/commands/telegram-outbound";
import { handChatToCurator } from "@/server/automation/actions";
import { CURATOR_HANDOFF_ACK } from "@/server/automation/curator-handoff";

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
      /** Set when this update stored a new /start greeting. */
      welcomeMessageId: string | null;
    };

/** Pooler RTT + cold start can exceed Prisma's 5s interactive default. */
const INGEST_TX_MAX_WAIT_MS = 10_000;
const INGEST_TX_TIMEOUT_MS = 20_000;

/** Worker must not send the greeting while the webhook is still posting it. */
export const WELCOME_OUTBOX_HOLD_MS = 60_000;

export async function ingestTelegramUpdate(input: {
  rawPayload: unknown;
  message: NormalizedTelegramMessage;
  /** The /start text is already on its way to Telegram. */
  deliverWelcomeOutside?: boolean;
}): Promise<IngestTelegramResult> {
  const { rawPayload, message } = input;
  const now = new Date();

  return prisma.$transaction(
    async (tx) => {
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
      const leadName = explicitTelegramLeadName(message.displayName);
      const lead = await tx.lead.create({
        data: {
          firstName: leadName.firstName,
          lastName: leadName.lastName,
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
    let welcomeMessageId: string | null = null;
    let appointmentConfirmed = false;
    if (createdInbound && message.text?.trim()) {
      const confirmed = await confirmAppointmentFromChat(tx, {
        conversationId: conversation.id,
        leadId,
        studentId,
        text: message.text,
        clientRequestId: `telegram:appt-confirm:${message.providerEventId}`,
      });
      appointmentConfirmed = confirmed.confirmed;
      if (confirmed.messageId) outboundMessageIds.push(confirmed.messageId);
    }

    const outbox = await enqueueOutbox(tx, {
      aggregateType: "ConversationMessage",
      aggregateId: messageId,
      eventType: "message.received",
      payload: {
        messageId,
        conversationId: conversation.id,
        channel: CHANNEL,
        providerEventId: message.providerEventId,
        appointmentConfirmed,
      },
      idempotencyKey: `telegram:update:${message.providerEventId}`,
    });

    if (createdInbound && (await resolveAutomationEnabled(tx))) {
      const command = parseTelegramBotCommand(message.text);
      const blockedMedia = messageHasBlockedMedia(message.attachments);
      const earlierInbound = await tx.conversationMessage.findMany({
        where: {
          conversationId: conversation.id,
          direction: "INBOUND",
          id: { not: messageId },
        },
        orderBy: { createdAt: "desc" },
        select: { body: true, attachmentsJson: true },
        take: 20,
      });
      const previousInbound = earlierInbound[0];
      const repeatedCommand = isSameConsecutiveCommand(command, previousInbound?.body);
      const repeatedMedia = blockedMedia && jsonHasBlockedMedia(previousInbound?.attachmentsJson);
      const openingText = earlierInbound.every(
        (row) =>
          parseTelegramBotCommand(row.body ?? "") !== null ||
          jsonHasBlockedMedia(row.attachmentsJson),
      );

      const sendOnce = async (body: string, clientRequestId: string) => {
        const sent = await requestTelegramSend({
          tx,
          conversationId: conversation.id,
          body,
          clientRequestId,
        });
        if (!sent.duplicate) outboundMessageIds.push(sent.message.id);
      };

      if (blockedMedia) {
        if (!repeatedMedia) {
          await sendOnce(
            TELEGRAM_MEDIA_REFUSAL_TEXT,
            `telegram:media:${message.providerEventId}`,
          );
        }
      } else if (command === "help") {
        if (!repeatedCommand) {
          await sendOnce(TELEGRAM_HELP_TEXT, `telegram:help:${message.providerEventId}`);
        }
      } else if (command === "start") {
        const sent = await requestTelegramSend({
          tx,
          conversationId: conversation.id,
          body: telegramWelcomeText(message.displayName),
          clientRequestId: `telegram:welcome:${conversation.id}`,
          outboxNotBefore: input.deliverWelcomeOutside
            ? new Date(now.getTime() + WELCOME_OUTBOX_HOLD_MS)
            : undefined,
        });
        if (!sent.duplicate) {
          outboundMessageIds.push(sent.message.id);
          welcomeMessageId = sent.message.id;
        }
      } else if (isTelegramPriceCommand(command)) {
        if (!repeatedCommand) {
          await sendOnce(TELEGRAM_PRICES_TEXT, `telegram:prices:${message.providerEventId}`);
        }
      } else if (!appointmentConfirmed) {
        if (openingText) {
          await sendOnce(
            telegramWelcomeText(message.displayName),
            `telegram:welcome:${conversation.id}`,
          );
        }
        if (await handChatToCurator(tx, conversation.id, now)) {
          await sendOnce(CURATOR_HANDOFF_ACK, `telegram:curator:${message.providerEventId}`);
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
      welcomeMessageId,
    };
    },
    { maxWait: INGEST_TX_MAX_WAIT_MS, timeout: INGEST_TX_TIMEOUT_MS },
  );
}
