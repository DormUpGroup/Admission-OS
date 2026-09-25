"use client";

import { useEffect, useRef } from "react";
import { useFormStatus } from "react-dom";
import { useRouter } from "next/navigation";
import { sendTelegramInboxReplyAction } from "@/server/inbox-actions";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

function SubmitButton({ variant }: { variant: "default" | "telegram" }) {
  const { pending } = useFormStatus();
  if (variant === "telegram") {
    return (
      <Button
        type="submit"
        size="sm"
        disabled={pending}
        className="h-9 shrink-0 rounded-full px-4"
      >
        {pending ? "…" : "Отправить"}
      </Button>
    );
  }
  return (
    <Button type="submit" size="sm" disabled={pending}>
      {pending ? "Отправка…" : "Отправить"}
    </Button>
  );
}

/** Legacy form used outside the fast Telegram messenger shell. */
export function AdminInboxReplyForm({
  conversationId,
  hasPendingDelivery,
  variant = "default",
}: {
  conversationId: string;
  hasPendingDelivery: boolean;
  variant?: "default" | "telegram";
}) {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (!hasPendingDelivery) return;
    const id = window.setInterval(() => {
      router.refresh();
    }, 2500);
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
      className={cn(
        variant === "telegram"
          ? "flex items-end gap-2"
          : "space-y-2 border-t border-black/5 pt-3",
      )}
    >
      <input type="hidden" name="conversationId" value={conversationId} />
      {variant === "telegram" ? (
        <textarea
          name="body"
          rows={1}
          required
          placeholder="Напишите клиенту…"
          className="max-h-32 min-h-9 flex-1 resize-none rounded-2xl border-0 bg-muted/80 px-3.5 py-2 text-sm outline-none placeholder:text-muted-foreground focus:bg-muted"
          onInput={(e) => {
            const el = e.currentTarget;
            el.style.height = "auto";
            el.style.height = `${Math.min(el.scrollHeight, 128)}px`;
          }}
        />
      ) : (
        <textarea
          name="body"
          rows={3}
          required
          placeholder="Напишите клиенту…"
          className="w-full rounded-md border border-black/10 bg-white px-3 py-2 text-sm"
        />
      )}
      <SubmitButton variant={variant} />
    </form>
  );
}
