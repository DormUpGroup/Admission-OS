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

  return (
    <Button
      type="button"
      size="sm"
      disabled={pending}
      onClick={() => {
        setPending(true);
        void promoteLeadToStudentAction(conversationId)
          .then((result) => {
            router.push(`/admin/students/${result.studentId}`);
            router.refresh();
          })
          .finally(() => setPending(false));
      }}
    >
      {pending ? "…" : label}
    </Button>
  );
}
