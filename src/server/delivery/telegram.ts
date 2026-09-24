import type { OutboxEvent, Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";

export const DELIVERY_STATUS = {
  PENDING: "PENDING",
  PROCESSING: "PROCESSING",
  SENT: "SENT",
  FAILED: "FAILED",
  UNKNOWN_REQUIRES_REVIEW: "UNKNOWN_REQUIRES_REVIEW",
} as const;

export type TelegramPrepareAction = "send" | "skip_success" | "skip_unknown";

export type PreparedTelegramDelivery = {
  action: TelegramPrepareAction;
  messageId: string;
  conversationId: string;
  chatId: string | null;
  body: string | null;
  attemptId: string | null;
  idempotencyKey: string;
};

export type TelegramCallResult = {
  providerMessageId: string;
};

export class TelegramRetryableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TelegramRetryableError";
  }
}

function metaChatId(metadata: Prisma.JsonValue | null | undefined): string | null {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    return null;
  }
  const chatId = (metadata as { chat_id?: unknown }).chat_id;
  return chatId != null ? String(chatId) : null;
}

export function isAmbiguousTelegramError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const name = error.name;
  if (
    name === "TimeoutError" ||
    name === "AbortError" ||
    name === "FetchError"
  ) {
    return true;
  }
  if (error.message.includes("fetch failed") || error.message.includes("network")) {
    return true;
  }
  if ("status" in error && typeof (error as { status?: number }).status === "number") {
    const status = (error as { status: number }).status;
    return status >= 500;
  }
  return false;
}

export async function prepareTelegramDelivery(
  event: OutboxEvent,
): Promise<PreparedTelegramDelivery> {
  const payload = event.payloadJson;
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new Error("telegram.send payload must be an object");
  }
  const messageId = String(
    (payload as { messageId?: unknown }).messageId ?? "",
  );
  if (!messageId) {
    throw new Error("telegram.send requires messageId");
  }

  return prisma.$transaction(async (tx) => {
    const message = await tx.conversationMessage.findUnique({
      where: { id: messageId },
      include: { conversation: true },
    });
    if (!message) {
      throw new Error(`ConversationMessage ${messageId} not found`);
    }

    const idempotencyKey = event.idempotencyKey;

    if (
      message.deliveryStatus === DELIVERY_STATUS.SENT ||
      message.deliveryStatus === "SUCCESS"
    ) {
      return {
        action: "skip_success" as const,
        messageId,
        conversationId: message.conversationId,
        chatId: null,
        body: message.body,
        attemptId: null,
        idempotencyKey,
      };
    }

    const prior = await tx.deliveryAttempt.findMany({
      where: { messageId, provider: "TELEGRAM" },
      orderBy: { attempt: "desc" },
    });

    const hasSuccess = prior.some(
      (a) => a.status === DELIVERY_STATUS.SENT || a.status === "SUCCESS",
    );
    if (hasSuccess) {
      return {
        action: "skip_success" as const,
        messageId,
        conversationId: message.conversationId,
        chatId: null,
        body: message.body,
        attemptId: null,
        idempotencyKey,
      };
    }

    const blocking = prior.find(
      (a) =>
        a.status === DELIVERY_STATUS.PROCESSING ||
        a.status === DELIVERY_STATUS.UNKNOWN_REQUIRES_REVIEW,
    );
    if (blocking) {
      if (blocking.status === DELIVERY_STATUS.PROCESSING) {
        await tx.deliveryAttempt.update({
          where: { id: blocking.id },
          data: {
            status: DELIVERY_STATUS.UNKNOWN_REQUIRES_REVIEW,
            errorCode: "RECLAIM_NO_RESEND",
            errorMessage:
              "Prior attempt left PROCESSING; refusing automatic resend",
          },
        });
      }
      await tx.conversationMessage.update({
        where: { id: messageId },
        data: { deliveryStatus: DELIVERY_STATUS.UNKNOWN_REQUIRES_REVIEW },
      });
      return {
        action: "skip_unknown" as const,
        messageId,
        conversationId: message.conversationId,
        chatId: null,
        body: message.body,
        attemptId: blocking.id,
        idempotencyKey,
      };
    }

    const conversation = message.conversation;
    const identity = await tx.channelIdentity.findFirst({
      where: {
        channel: "TELEGRAM",
        OR: [
          ...(conversation.leadId ? [{ leadId: conversation.leadId }] : []),
          ...(conversation.studentId
            ? [{ studentId: conversation.studentId }]
            : []),
        ],
      },
      orderBy: { updatedAt: "desc" },
    });

    const chatId = metaChatId(identity?.metadataJson ?? null);
    if (!chatId) {
      throw new TelegramRetryableError(
        "No Telegram chat_id on ChannelIdentity metadata",
      );
    }
    if (!message.body?.trim()) {
      throw new Error("Outbound message body is empty");
    }

    const nextAttempt = (prior[0]?.attempt ?? 0) + 1;
    const attempt = await tx.deliveryAttempt.create({
      data: {
        messageId,
        outboxEventId: event.id,
        provider: "TELEGRAM",
        attempt: nextAttempt,
        status: DELIVERY_STATUS.PROCESSING,
      },
    });

    await tx.conversationMessage.update({
      where: { id: messageId },
      data: { deliveryStatus: DELIVERY_STATUS.PROCESSING },
    });

    return {
      action: "send" as const,
      messageId,
      conversationId: message.conversationId,
      chatId,
      body: message.body,
      attemptId: attempt.id,
      idempotencyKey,
    };
  });
}

export async function callTelegramDelivery(
  prepared: PreparedTelegramDelivery,
  env: NodeJS.ProcessEnv = process.env,
): Promise<TelegramCallResult> {
  if (prepared.action !== "send" || !prepared.chatId || !prepared.body) {
    throw new Error("callTelegramDelivery requires action=send with chatId/body");
  }
  const token = env.TELEGRAM_BOT_TOKEN?.trim();
  if (!token) {
    throw new Error("TELEGRAM_BOT_TOKEN is not configured");
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20_000);
  try {
    const response = await fetch(
      `https://api.telegram.org/bot${token}/sendMessage`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-IMMIGROME-Idempotency-Key": prepared.idempotencyKey,
        },
        body: JSON.stringify({
          chat_id: prepared.chatId,
          text: prepared.body,
          disable_web_page_preview: true,
        }),
        signal: controller.signal,
      },
    );

    const data = (await response.json().catch(() => null)) as {
      ok?: boolean;
      result?: { message_id?: number | string };
      description?: string;
    } | null;

    if (!response.ok) {
      const err = new Error(
        data?.description ?? `Telegram HTTP ${response.status}`,
      ) as Error & { status: number };
      err.status = response.status;
      err.name = response.status >= 500 ? "TelegramServerError" : "TelegramClientError";
      throw err;
    }
    if (!data?.ok || data.result?.message_id == null) {
      throw new Error("Telegram returned an invalid sendMessage response");
    }
    return { providerMessageId: String(data.result.message_id) };
  } finally {
    clearTimeout(timer);
  }
}

export async function finalizeTelegramDelivery(
  prepared: PreparedTelegramDelivery,
  options:
    | { result: TelegramCallResult }
    | { error: unknown }
    | { skip: "success" | "unknown" },
): Promise<"completed" | "retry"> {
  if ("skip" in options) {
    return "completed";
  }

  if ("result" in options) {
    await prisma.$transaction(async (tx) => {
      if (prepared.attemptId) {
        await tx.deliveryAttempt.update({
          where: { id: prepared.attemptId },
          data: {
            status: DELIVERY_STATUS.SENT,
            providerResponseId: options.result.providerMessageId,
            errorCode: null,
            errorMessage: null,
          },
        });
      }
      await tx.conversationMessage.update({
        where: { id: prepared.messageId },
        data: {
          deliveryStatus: DELIVERY_STATUS.SENT,
          providerMessageId: options.result.providerMessageId,
          sentAt: new Date(),
        },
      });
    });
    return "completed";
  }

  const error = options.error;
  const message = error instanceof Error ? error.message : String(error);
  const ambiguous = isAmbiguousTelegramError(error);

  if (ambiguous) {
    await prisma.$transaction(async (tx) => {
      if (prepared.attemptId) {
        await tx.deliveryAttempt.update({
          where: { id: prepared.attemptId },
          data: {
            status: DELIVERY_STATUS.UNKNOWN_REQUIRES_REVIEW,
            errorCode: "AMBIGUOUS_TRANSPORT",
            errorMessage: message.slice(0, 1000),
          },
        });
      }
      await tx.conversationMessage.update({
        where: { id: prepared.messageId },
        data: { deliveryStatus: DELIVERY_STATUS.UNKNOWN_REQUIRES_REVIEW },
      });
    });
    return "completed";
  }

  await prisma.$transaction(async (tx) => {
    if (prepared.attemptId) {
      await tx.deliveryAttempt.update({
        where: { id: prepared.attemptId },
        data: {
          status: DELIVERY_STATUS.FAILED,
          errorCode: "TELEGRAM_CLIENT_ERROR",
          errorMessage: message.slice(0, 1000),
        },
      });
    }
    await tx.conversationMessage.update({
      where: { id: prepared.messageId },
      data: { deliveryStatus: DELIVERY_STATUS.FAILED },
    });
  });
  return "retry";
}
