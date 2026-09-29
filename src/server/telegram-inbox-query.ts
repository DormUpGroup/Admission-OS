import { prisma } from "@/lib/db";
import { isUnreadInbound } from "@/lib/message-unread-counts";
import {
  isBotCommandBody,
  isFixtureContact,
  pickPreviewMessage,
  resolveConversationFolder,
  type ConversationFolder,
} from "@/lib/telegram-conversation-kind";

export type TelegramListItemDto = {
  id: string;
  title: string;
  preview: string;
  previewAt: string | null;
  undelivered: boolean;
  deliveryStatus: string | null;
  /** Matches the sidebar badge: open client thread with inbound after the last open. */
  unread: boolean;
  automationPaused: boolean;
  /** Cabinet created from the booking link of this chat. */
  onPlatform: boolean;
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
  leadId: string | null;
  studentId: string | null;
  onPlatform: boolean;
  automationPaused: boolean;
  hasPendingDelivery: boolean;
  /** Latest Hermes draft that has not been sent yet. */
  replyDraft: string | null;
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

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function newestDraftDecision(
  drafts: unknown[],
): { body: string; createdAt: string | null; index: number } | "discarded" | null {
  for (let i = drafts.length - 1; i >= 0; i--) {
    const item = asRecord(drafts[i]);
    if (!item) continue;
    const body = typeof item.body === "string" ? item.body.trim() : "";
    if (!body) continue;
    if (item.discarded === true) return "discarded";
    return {
      body,
      createdAt: typeof item.createdAt === "string" ? item.createdAt : null,
      index: i,
    };
  }
  return null;
}

/** Newest propose_reply body, unless staff already sent it, replied later, or discarded it. */
export function latestUnsentReplyDraft(
  runs: Array<{ outputJson: unknown }>,
  messages: Array<{ direction: string; body: string | null; createdAt: Date | string }>,
): string | null {
  let draftBody = "";
  let draftTime = Number.NaN;
  for (const run of runs) {
    const drafts = asRecord(run.outputJson)?.drafts;
    if (!Array.isArray(drafts)) continue;
    const decision = newestDraftDecision(drafts);
    if (decision === "discarded") return null;
    if (!decision) continue;
    draftBody = decision.body;
    draftTime = decision.createdAt ? Date.parse(decision.createdAt) : Number.NaN;
    break;
  }
  if (!draftBody) return null;

  for (const message of messages) {
    if (message.direction !== "OUTBOUND") continue;
    const sent = (message.body ?? "").trim();
    if (sent === draftBody) return null;
    const sentAt = new Date(message.createdAt).getTime();
    if (Number.isFinite(draftTime) && sentAt >= draftTime) return null;
  }
  return draftBody;
}

/** The draft `latestUnsentReplyDraft` would show, so a curator can edit or discard it. */
export function locateLatestReplyDraft(
  runs: Array<{ id: string; outputJson: unknown }>,
): { runId: string; draftIndex: number } | null {
  for (const run of runs) {
    const drafts = asRecord(run.outputJson)?.drafts;
    if (!Array.isArray(drafts)) continue;
    const decision = newestDraftDecision(drafts);
    if (decision === "discarded") return null;
    if (decision) return { runId: run.id, draftIndex: decision.index };
  }
  return null;
}

/** Empty text discards the draft. A new text replaces it. Returns null when nothing changes. */
export function applyReplyDraftRevision(
  outputJson: unknown,
  draftIndex: number,
  nextBody: string | null,
): Record<string, unknown> | null {
  const existing = asRecord(outputJson);
  if (!existing || !Array.isArray(existing.drafts)) return null;
  const current = asRecord(existing.drafts[draftIndex]);
  if (!current) return null;
  const trimmed = nextBody?.trim() ?? "";
  const drafts = existing.drafts.slice();
  if (!trimmed) {
    if (current.discarded === true) return null;
    drafts[draftIndex] = { ...current, discarded: true };
  } else {
    const body = typeof current.body === "string" ? current.body.trim() : "";
    if (body === trimmed && current.discarded !== true) return null;
    drafts[draftIndex] = { ...current, body: trimmed, discarded: false };
  }
  return { ...existing, drafts };
}

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

/**
 * Client replies can sit behind a long run of curator/bot messages.
 * The sidebar preview only loads the latest few, so folder placement
 * has to look at the whole inbound history.
 */
async function humanInboundConversationIds(
  conversationIds: string[],
): Promise<Set<string>> {
  if (conversationIds.length === 0) return new Set();
  const rows = await prisma.conversationMessage.findMany({
    where: {
      conversationId: { in: conversationIds },
      direction: "INBOUND",
    },
    select: { conversationId: true, body: true },
  });
  return new Set(
    rows
      .filter((row) => !isBotCommandBody(row.body))
      .map((row) => row.conversationId),
  );
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
  trash: TelegramListItemDto[];
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
          userId: true,
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
  const trash: TelegramListItemDto[] = [];
  const humanInboundIds = await humanInboundConversationIds(
    conversations.map((c) => c.id),
  );

  for (const c of conversations) {
    const baseName = conversationBaseName(c);
    const username = primaryIdentity(c)?.username ?? null;
    const title = conversationTitle(c);
    const folder = resolveConversationFolder({
      messages: c.messages,
      contact: { title: baseName, username },
      hasHumanInbound: humanInboundIds.has(c.id),
      inboxFolder: c.inboxFolder,
      audience: c.studentId ? "student" : "lead",
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
      unread:
        c.status === "OPEN" &&
        isUnreadInbound({
          lastInboundAt: c.lastInboundAt,
          staffLastReadAt: c.staffLastReadAt,
        }) &&
        !isFixtureContact({ title: baseName, username }),
      automationPaused: !!c.automationPausedAt,
      onPlatform: Boolean(c.student?.userId),
    };
    if (folder === "trash") trash.push(item);
    else if (folder === "technical") technical.push(item);
    else chats.push(item);
  }

  return { chats, technical, trash };
}

export function folderList(
  folder: ConversationFolder,
  lists: {
    chats: TelegramListItemDto[];
    technical: TelegramListItemDto[];
    trash: TelegramListItemDto[];
  },
): TelegramListItemDto[] {
  if (folder === "technical") return lists.technical;
  if (folder === "trash") return lists.trash;
  return lists.chats;
}

export async function loadTelegramThread(
  conversationId: string,
  options?: { markRead?: boolean },
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
          userId: true,
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

  const contactName = conversationBaseName(row);
  const staffIds = [
    ...new Set(
      row.messages
        .map((m) => m.senderUserId)
        .filter((id): id is string => Boolean(id)),
    ),
  ];
  const needsReadMark =
    options?.markRead !== false &&
    row.lastInboundAt != null &&
    (row.staffLastReadAt == null || row.lastInboundAt > row.staffLastReadAt);

  const [runs, staffUsers] = await Promise.all([
    prisma.agentRun.findMany({
      where: { conversationId: row.id },
      orderBy: { createdAt: "desc" },
      take: 8,
      select: { outputJson: true },
    }),
    staffIds.length > 0
      ? prisma.user.findMany({
          where: { id: { in: staffIds } },
          select: { id: true, name: true },
        })
      : Promise.resolve([]),
    needsReadMark
      ? prisma.conversation.update({
          where: { id: row.id },
          data: { staffLastReadAt: new Date() },
        })
      : Promise.resolve(null),
  ]);
  const replyDraft = latestUnsentReplyDraft(runs, row.messages);
  const staffNameById = new Map(staffUsers.map((u) => [u.id, u.name]));

  return {
    id: row.id,
    title: conversationTitle(row),
    contactName,
    leadId: row.studentId ? null : row.leadId,
    studentId: row.studentId,
    onPlatform: Boolean(row.student?.userId),
    automationPaused: !!row.automationPausedAt,
    replyDraft,
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
      const clientSeen =
        outbound &&
        row.messages.some(
          (other) =>
            other.direction === "INBOUND" &&
            other.createdAt.getTime() > m.createdAt.getTime(),
        );
      return {
        id: m.id,
        direction: m.direction,
        body: m.body,
        createdAt: m.createdAt.toISOString(),
        deliveryStatus: m.deliveryStatus,
        clientSeen,
        attemptError,
        senderName,
      };
    }),
  };
}
