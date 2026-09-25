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
  senderName: string;
};

export type TelegramThreadDto = {
  id: string;
  title: string;
  contactName: string;
  automationPaused: boolean;
  hasPendingDelivery: boolean;
  messages: TelegramThreadMessageDto[];
};

type IdentityBits = {
  username?: string | null;
  displayName?: string | null;
};

type TitleSource = {
  id: string;
  lead?: {
    id: string;
    firstName: string | null;
    lastName: string | null;
    channelIdentities?: IdentityBits[];
  } | null;
  student?: {
    firstName: string;
    lastName: string;
    channelIdentities?: IdentityBits[];
  } | null;
};

const identitySelect = {
  where: { channel: "TELEGRAM" as const },
  select: { username: true, displayName: true },
  take: 1,
};

function primaryIdentity(c: TitleSource): IdentityBits | null {
  return (
    c.lead?.channelIdentities?.[0] ??
    c.student?.channelIdentities?.[0] ??
    null
  );
}

/** Display name without @username (for fixture classification). */
export function conversationBaseName(c: TitleSource): string {
  if (c.student) {
    return `${c.student.firstName} ${c.student.lastName}`.trim();
  }
  if (c.lead) {
    const leadName = [c.lead.firstName, c.lead.lastName]
      .filter(Boolean)
      .join(" ")
      .trim();
    if (leadName) return leadName;
    const display = primaryIdentity(c)?.displayName?.trim();
    if (display) return display;
    return `Клиент ${c.lead.id.slice(0, 8)}`;
  }
  const display = primaryIdentity(c)?.displayName?.trim();
  if (display) return display;
  return `Чат ${c.id.slice(0, 8)}`;
}

export function conversationTitle(c: TitleSource): string {
  const base = conversationBaseName(c);
  const username = primaryIdentity(c)?.username?.trim();
  if (username) return `${base} · @${username.replace(/^@/, "")}`;
  return base;
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
          channelIdentities: identitySelect,
        },
      },
      student: {
        select: {
          id: true,
          firstName: true,
          lastName: true,
          channelIdentities: identitySelect,
        },
      },
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
    const baseName = conversationBaseName(c);
    const username = primaryIdentity(c)?.username ?? null;
    const title = conversationTitle(c);
    const isTech = isTechnicalConversation(c.messages, {
      title: baseName,
      username,
    });
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
      lead: {
        select: {
          id: true,
          firstName: true,
          lastName: true,
          channelIdentities: identitySelect,
        },
      },
      student: {
        select: {
          id: true,
          firstName: true,
          lastName: true,
          channelIdentities: identitySelect,
        },
      },
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

  const now = new Date();
  const needsReadMark =
    row.lastInboundAt != null &&
    (row.staffLastReadAt == null || row.lastInboundAt > row.staffLastReadAt);
  if (needsReadMark) {
    await prisma.conversation.update({
      where: { id: row.id },
      data: { staffLastReadAt: now },
    });
  }

  const contactName = conversationBaseName(row);
  const staffIds = [
    ...new Set(
      row.messages
        .map((m) => m.senderUserId)
        .filter((id): id is string => Boolean(id)),
    ),
  ];
  const staffUsers =
    staffIds.length > 0
      ? await prisma.user.findMany({
          where: { id: { in: staffIds } },
          select: { id: true, name: true },
        })
      : [];
  const staffNameById = new Map(staffUsers.map((u) => [u.id, u.name]));

  return {
    id: row.id,
    title: conversationTitle(row),
    contactName,
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
      const senderName = outbound
        ? (m.senderUserId
            ? staffNameById.get(m.senderUserId)?.trim() || "Куратор"
            : "Бот")
        : contactName;
      return {
        id: m.id,
        direction: m.direction,
        body: m.body,
        createdAt: m.createdAt.toISOString(),
        deliveryStatus: m.deliveryStatus,
        attemptError,
        senderName,
      };
    }),
  };
}
