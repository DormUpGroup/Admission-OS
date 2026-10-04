"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { requestStudentQuestionnaireAction } from "@/server/actions";

export function RequestQuestionnaireButton({
  studentId,
  label = "Попросить заполнить",
}: {
  studentId: string;
  label?: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);

  return (
    <div className="space-y-1">
      <Button
        type="button"
        size="sm"
        variant="outline"
        className="rounded-lg"
        disabled={pending}
        onClick={() => {
          setError("");
          setDone(false);
          const data = new FormData();
          data.set("studentId", studentId);
          startTransition(() => {
            void requestStudentQuestionnaireAction(data).then((result) => {
              if (result && "error" in result && result.error) {
                setError(result.error);
                return;
              }
              setDone(true);
              router.refresh();
            });
          });
        }}
      >
        {pending ? "…" : done ? "Отправлено" : label}
      </Button>
      {error ? (
        <p className="text-[12px] text-[var(--danger-fg)]" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
