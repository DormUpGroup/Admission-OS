"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { resetUniversitalyCacheAction } from "@/server/actions";

export function ResetUniversitalyCacheButton({
  disabled,
}: {
  disabled?: boolean;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  async function handleReset() {
    const confirmed = window.confirm(
      "Очистить кэш вузов, найденных на Universitaly? Сидовые программы останутся. Следующий подбор снова пойдёт в сеть."
    );
    if (!confirmed) return;

    setPending(true);
    try {
      await resetUniversitalyCacheAction();
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
      {pending ? "Очистка…" : "Очистить кэш вузов"}
    </Button>
  );
}
