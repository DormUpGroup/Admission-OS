import { requireStaff } from "@/server/auth/guards";
import { EmptyState } from "@/components/empty-state";
import { TelegramMessenger } from "@/components/admin/telegram-messenger";
import { parseConversationFolder } from "@/lib/telegram-conversation-kind";
import {
  folderList,
  listTelegramConversations,
  loadTelegramThread,
} from "@/server/telegram-inbox-query";

export default async function AdminTelegramMessagesPage({
  searchParams,
}: {
  searchParams: Promise<{ conversationId?: string; folder?: string }>;
}) {
  await requireStaff();
  const { conversationId, folder: folderParam } = await searchParams;
  const folder = parseConversationFolder(folderParam);

  const lists = await listTelegramConversations();
  const list = folderList(folder, lists);

  if (lists.chats.length === 0 && lists.technical.length === 0) {
    return (
      <div className="-m-6 flex h-[calc(100vh-3rem)] items-center justify-center bg-[#eef2f5]">
        <EmptyState
          title="Пока нет диалогов"
          description="Как только клиент напишет боту, разговор появится здесь."
        />
      </div>
    );
  }

  const activeId =
    conversationId && list.some((c) => c.id === conversationId)
      ? conversationId
      : (list[0]?.id ?? null);

  const active = activeId ? await loadTelegramThread(activeId) : null;

  return (
    <TelegramMessenger
      folder={folder}
      chatsCount={lists.chats.length}
      technicalCount={lists.technical.length}
      conversations={list}
      initialActive={active}
    />
  );
}
