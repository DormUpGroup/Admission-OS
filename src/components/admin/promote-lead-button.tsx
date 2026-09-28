"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { promoteLeadToStudentAction } from "@/server/inbox-actions";

export function PromoteLeadButton({
  conversationId,
  label = "Сделать учеником",
}: {
  conversationId: string;
  label?: string;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  return (
    <span className="inline-flex flex-col items-end gap-1">
      <Button
        type="button"
        size="sm"
        disabled={pending}
        onClick={() => {
          setPending(true);
          setError("");
          void promoteLeadToStudentAction(conversationId)
            .then((result) => {
              router.push(`/admin/students/${result.studentId}`);
              router.refresh();
            })
            .catch((caught: unknown) => {
              setError(caught instanceof Error ? caught.message : "Не удалось отправить письмо");
            })
            .finally(() => setPending(false));
        }}
      >
        {pending ? "…" : label}
      </Button>
      {error ? (
        <p className="max-w-xs text-right text-[12px] text-[var(--danger-fg)]" role="alert">
          {error}
        </p>
      ) : null}
    </span>
  );
}
