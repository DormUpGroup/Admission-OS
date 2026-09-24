"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import {
  clearStableCommandId,
  getStableCommandId,
} from "@/components/command-id-input";
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
    const commandParts = {
      operation: "program-matches.reset",
      entityId: studentId,
      formInstance: "reset-button",
    };
    try {
      const formData = new FormData();
      formData.set("studentId", studentId);
      formData.set("commandId", getStableCommandId(commandParts));
      await resetProgramMatchesAction(formData);
      clearStableCommandId(commandParts);
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
