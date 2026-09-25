import { prisma } from "@/lib/db";
import { requireStaff } from "@/server/auth/guards";
import { EmptyState } from "@/components/empty-state";
import {
  TelegramMessenger,
  type TelegramActiveThread,
  type TelegramListItem,
} from "@/components/admin/telegram-messenger";
import {
  isTechnicalConversation,
  parseConversationFolder,
  pickPreviewMessage,
} from "@/lib/telegram-conversation-kind";

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

export default async function AdminTelegramMessagesPage({
  searchParams,
}: {
  searchParams: Promise<{ conversationId?: string; folder?: string }>;
}) {
  await requireStaff();
  const { conversationId, folder: folderParam } = await searchParams;
  const folder = parseConversationFolder(folderParam);

  const conversations = await prisma.conversation.findMany({
    where: { channel: "TELEGRAM" },
    include: {
      lead: { select: { id: true, firstName: true, lastName: true } },
      student: { select: { id: true, firstName: true, lastName: true } },
      messages: {
        orderBy: { createdAt: "desc" },
        take: 40,
        select: {
          id: true,
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

  const classified = conversations.map((c) => {
    const technical = isTechnicalConversation(c.messages);
    const previewMsg = pickPreviewMessage(c.messages);
    const last = c.messages[0];
    return {
      conversation: c,
      technical,
      listItem: {
        id: c.id,
        title: conversationTitle(c),
        preview: previewMsg?.body || "—",
        previewAt: previewMsg?.createdAt?.toISOString() ?? null,
        undelivered:
          !!last &&
          last.direction === "OUTBOUND" &&
          isUndeliveredOutbound(last.deliveryStatus),
        deliveryStatus:
          last?.direction === "OUTBOUND" ? last.deliveryStatus : null,
      } satisfies TelegramListItem,
    };
  });

  const chats = classified.filter((c) => !c.technical);
  const technical = classified.filter((c) => c.technical);
  const folderItems = folder === "technical" ? technical : chats;
  const list = folderItems.map((c) => c.listItem);

  const chatsCount = chats.length;
  const technicalCount = technical.length;

  const activeId =
    conversationId && list.some((c) => c.id === conversationId)
      ? conversationId
      : (list[0]?.id ?? null);

  const activeRow = activeId
    ? await prisma.conversation.findUnique({
        where: { id: activeId },
        include: {
          lead: true,
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
      })
    : null;

  const active: TelegramActiveThread | null = activeRow
    ? {
        id: activeRow.id,
        title: conversationTitle(activeRow),
        automationPaused: !!activeRow.automationPausedAt,
        hasPendingDelivery: activeRow.messages.some(
          (m) =>
            m.direction === "OUTBOUND" &&
            (m.deliveryStatus === "PENDING" ||
              m.deliveryStatus === "PROCESSING"),
        ),
        messages: activeRow.messages.map((m) => {
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
      }
    : null;

  if (conversations.length === 0) {
    return (
      <div className="-m-6 flex h-[calc(100vh-3rem)] items-center justify-center bg-[#eef2f5]">
        <EmptyState
          title="Пока нет диалогов"
          description="Как только клиент напишет боту, разговор появится здесь."
        />
      </div>
    );
  }

  return (
    <TelegramMessenger
      folder={folder}
      chatsCount={chatsCount}
      technicalCount={technicalCount}
      conversations={list}
      active={active}
    />
  );
}
