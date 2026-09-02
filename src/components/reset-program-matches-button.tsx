"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { resetProgramMatchesAction } from "@/server/actions";

export function ResetProgramMatchesButton({
  studentId,
  disabled,
}: {
  studentId: string;
  disabled?: boolean;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  async function handleReset() {
    const confirmed = window.confirm(
      "Сбросить все подобранные программы и shortlist? После этого нужно будет запустить подбор заново."
    );
    if (!confirmed) return;

    setPending(true);
    try {
      const formData = new FormData();
      formData.set("studentId", studentId);
      await resetProgramMatchesAction(formData);
      router.refresh();
    } finally {
      setPending(false);
    }
  }

  return (
    <Button
      type="button"
      variant="outline"
      onClick={handleReset}
      disabled={disabled || pending}
    >
      {pending ? "Сброс…" : "Сбросить программы"}
    </Button>
  );
}
