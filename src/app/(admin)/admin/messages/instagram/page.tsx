import { requireStaff } from "@/server/auth/guards";
import { ChannelMessenger } from "@/components/admin/channel-messenger";

export default async function AdminInstagramMessagesPage() {
  await requireStaff();

  return (
    <ChannelMessenger
      channelLabel="Instagram"
      conversations={[]}
      active={null}
      conversationHref="/admin/messages/instagram"
      emptyListText="Канал Instagram ещё не подключён"
      emptyThreadText="Coming soon — переписка в Instagram появится здесь"
    />
  );
}
