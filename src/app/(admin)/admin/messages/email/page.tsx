import { requireStaff } from "@/server/auth/guards";
import { ChannelMessenger } from "@/components/admin/channel-messenger";

export default async function AdminEmailMessagesPage() {
  await requireStaff();

  return (
    <ChannelMessenger
      channelLabel="Почта"
      conversations={[]}
      active={null}
      conversationHref="/admin/messages/email"
      emptyListText="Канал почты ещё не подключён"
      emptyThreadText="Coming soon — переписка по email появится здесь"
    />
  );
}
