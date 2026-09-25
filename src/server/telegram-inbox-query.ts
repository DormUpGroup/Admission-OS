import { prisma } from "@/lib/db";
import {
  isTechnicalConversation,
  pickPreviewMessage,
  type ConversationFolder,
} from "@/lib/telegram-conversation-kind";

export type TelegramListItemDto = {
  id: string;
  title: string;
  preview: string;
  previewAt: string | null;
  undelivered: boolean;
  deliveryStatus: string | null;
  technical: boolean;
};

export type TelegramThreadMessageDto = {
  id: string;
  direction: string;
  body: string | null;
  createdAt: string;
  deliveryStatus: string;
  attemptError: string | null;
};

export type TelegramThreadDto = {
  id: string;
  title: string;
  automationPaused: boolean;
  hasPendingDelivery: boolean;
  messages: TelegramThreadMessageDto[];
};

function conversationTitle(c: {
  id: string;
  lead?: { id: string; firstName: string | null; lastName: string | null } | null;
  student?: { firstName: string; lastName: string } | null;
}) {
  if (c.lead) {
    const name = [c.lead.firstName, c.lead.lastName].filter(Boolean).join(" ");
    return name || `Клиент ${c.lead.id.slice(0, 8)}`;
  }
  if (c.student) {
    return `${c.student.firstName} ${c.student.lastName}`;
  }
  return `Чат ${c.id.slice(0, 8)}`;
}

function isUndeliveredOutbound(status: string) {
  return (
    status === "PENDING" ||
    status === "PROCESSING" ||
    status === "FAILED" ||
    status === "UNKNOWN_REQUIRES_REVIEW"
  );
}

export async function listTelegramConversations(): Promise<{
  chats: TelegramListItemDto[];
  technical: TelegramListItemDto[];
}> {
  const conversations = await prisma.conversation.findMany({
    where: { channel: "TELEGRAM" },
    include: {
      lead: {
        select: {
          id: true,
          firstName: true,
          lastName: true,
          channelIdentities: {
            where: { channel: "TELEGRAM" },
            select: { username: true },
            take: 1,
          },
        },
      },
      student: { select: { id: true, firstName: true, lastName: true } },
      // Enough recent rows for preview + command-only classification.
      messages: {
        orderBy: { createdAt: "desc" },
        take: 12,
        select: {
          direction: true,
          body: true,
          createdAt: true,
          deliveryStatus: true,
        },
      },
    },
    orderBy: [{ lastInboundAt: "desc" }, { updatedAt: "desc" }],
    take: 80,
  });

  const chats: TelegramListItemDto[] = [];
  const technical: TelegramListItemDto[] = [];

  for (const c of conversations) {
    const title = conversationTitle(c);
    const username = c.lead?.channelIdentities[0]?.username ?? null;
    const isTech = isTechnicalConversation(c.messages, { title, username });
    const previewMsg = pickPreviewMessage(c.messages);
    const last = c.messages[0];
    const item: TelegramListItemDto = {
      id: c.id,
      title,
      preview: previewMsg?.body || "—",
      previewAt: previewMsg?.createdAt?.toISOString() ?? null,
      undelivered:
        !!last &&
        last.direction === "OUTBOUND" &&
        isUndeliveredOutbound(last.deliveryStatus),
      deliveryStatus:
        last?.direction === "OUTBOUND" ? last.deliveryStatus : null,
      technical: isTech,
    };
    if (isTech) technical.push(item);
    else chats.push(item);
  }

  return { chats, technical };
}

export function folderList(
  folder: ConversationFolder,
  lists: { chats: TelegramListItemDto[]; technical: TelegramListItemDto[] },
): TelegramListItemDto[] {
  return folder === "technical" ? lists.technical : lists.chats;
}

export async function loadTelegramThread(
  conversationId: string,
): Promise<TelegramThreadDto | null> {
  const row = await prisma.conversation.findUnique({
    where: { id: conversationId },
    include: {
      lead: { select: { id: true, firstName: true, lastName: true } },
      student: { select: { id: true, firstName: true, lastName: true } },
      messages: {
        orderBy: { createdAt: "asc" },
        take: 100,
        include: {
          deliveryAttempts: {
            orderBy: { attempt: "desc" },
            take: 1,
          },
        },
      },
    },
  });
  if (!row || row.channel !== "TELEGRAM") return null;

  return {
    id: row.id,
    title: conversationTitle(row),
    automationPaused: !!row.automationPausedAt,
    hasPendingDelivery: row.messages.some(
      (m) =>
        m.direction === "OUTBOUND" &&
        (m.deliveryStatus === "PENDING" || m.deliveryStatus === "PROCESSING"),
    ),
    messages: row.messages.map((m) => {
      const outbound = m.direction === "OUTBOUND";
      const attemptError =
        outbound &&
        (m.deliveryStatus === "FAILED" ||
          m.deliveryStatus === "UNKNOWN_REQUIRES_REVIEW")
          ? (m.deliveryAttempts[0]?.errorMessage ?? null)
          : null;
      return {
        id: m.id,
        direction: m.direction,
        body: m.body,
        createdAt: m.createdAt.toISOString(),
        deliveryStatus: m.deliveryStatus,
        attemptError,
      };
    }),
  };
}
