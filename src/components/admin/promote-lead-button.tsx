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
  const [warning, setWarning] = useState("");

  return (
    <span className="inline-flex flex-col items-end gap-1">
      <Button
        type="button"
        size="sm"
        disabled={pending}
        onClick={() => {
          setPending(true);
          setError("");
          setWarning("");
          void promoteLeadToStudentAction(conversationId)
            .then((result) => {
              if ("error" in result) {
                setError(result.error);
                return;
              }
              if (result.warning) {
                setWarning(result.warning);
              }
              router.push(`/admin/students/${result.studentId}`);
              router.refresh();
            })
            .catch(() => {
              setError("Не удалось сделать учеником");
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
      {warning ? (
        <p className="max-w-xs text-right text-[12px] text-amber-700" role="status">
          {warning}
        </p>
      ) : null}
    </span>
  );
}
