import { redirect } from "next/navigation";

export default async function AdminInboxRedirectPage({
  searchParams,
}: {
  searchParams: Promise<{ conversationId?: string }>;
}) {
  const { conversationId } = await searchParams;
  if (conversationId?.trim()) {
    redirect(
      `/admin/messages/telegram?conversationId=${encodeURIComponent(conversationId.trim())}`,
    );
  }
  redirect("/admin/messages/telegram");
}
