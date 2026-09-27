"use client";

import Link from "next/link";
import {
  ChannelMessenger,
  type ChannelActiveThread,
  type ChannelListItem,
} from "@/components/admin/channel-messenger";
import { SiteInboxReplyForm } from "@/components/admin/site-inbox-reply-form";
import { Button } from "@/components/ui/button";

export function SiteMessenger({
  conversations,
  active,
  openOnMobile = false,
}: {
  conversations: ChannelListItem[];
  active: (ChannelActiveThread & { studentId: string }) | null;
  openOnMobile?: boolean;
}) {
  return (
    <ChannelMessenger
      channelLabel="Сайт"
      conversations={conversations}
      active={
        active
          ? {
              id: active.id,
              title: active.title,
              subtitle: active.subtitle,
              headerExtra: (
                <Button asChild size="sm" variant="outline" className="shrink-0">
                  <Link href={`/admin/students/${active.studentId}`}>Открыть</Link>
                </Button>
              ),
              messages: active.messages,
            }
          : null
      }
      conversationHref="/admin/messages/site?studentId={id}"
      openOnMobile={openOnMobile}
      emptyListText="Пока нет диалогов со студентами"
      emptyThreadText="Выберите диалог"
      compose={
        active ? <SiteInboxReplyForm studentId={active.studentId} /> : null
      }
    />
  );
}
