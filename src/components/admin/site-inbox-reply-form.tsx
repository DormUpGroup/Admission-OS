"use client";

import { useRef } from "react";
import { useFormStatus } from "react-dom";
import { useRouter } from "next/navigation";
import { sendCuratorMessageAction } from "@/server/actions";
import { Button } from "@/components/ui/button";

function SubmitButton() {
  const { pending } = useFormStatus();
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

export function SiteInboxReplyForm({ studentId }: { studentId: string }) {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);

  return (
    <form
      ref={formRef}
      action={async (formData) => {
        await sendCuratorMessageAction(formData);
        formRef.current?.reset();
        router.refresh();
      }}
      className="flex items-end gap-2"
    >
      <input type="hidden" name="studentId" value={studentId} />
      <textarea
        name="message"
        rows={1}
        required
        maxLength={2000}
        placeholder="Написать студенту…"
        className="max-h-32 min-h-9 flex-1 resize-none rounded-2xl border-0 bg-muted/80 px-3.5 py-2 text-sm outline-none placeholder:text-muted-foreground focus:bg-muted"
        onInput={(e) => {
          const el = e.currentTarget;
          el.style.height = "auto";
          el.style.height = `${Math.min(el.scrollHeight, 128)}px`;
        }}
      />
      <SubmitButton />
    </form>
  );
}
