"use client";

import { useEffect, useRef } from "react";
import { useFormStatus } from "react-dom";
import { useRouter } from "next/navigation";
import { sendTelegramInboxReplyAction } from "@/server/inbox-actions";
import { Button } from "@/components/ui/button";

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="sm" disabled={pending}>
      {pending ? "Отправка…" : "Отправить"}
    </Button>
  );
}

export function AdminInboxReplyForm({
  conversationId,
  hasPendingDelivery,
}: {
  conversationId: string;
  hasPendingDelivery: boolean;
}) {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (!hasPendingDelivery) return;
    const id = window.setInterval(() => {
      router.refresh();
    }, 1500);
    return () => window.clearInterval(id);
  }, [hasPendingDelivery, router]);

  return (
    <form
      ref={formRef}
      action={async (formData) => {
        await sendTelegramInboxReplyAction(formData);
        formRef.current?.reset();
        router.refresh();
      }}
      className="space-y-2 border-t border-black/5 pt-3"
    >
      <input type="hidden" name="conversationId" value={conversationId} />
      <textarea
        name="body"
        rows={3}
        required
        placeholder="Напишите клиенту…"
        className="w-full rounded-md border border-black/10 bg-white px-3 py-2 text-sm"
      />
      <SubmitButton />
    </form>
  );
}
