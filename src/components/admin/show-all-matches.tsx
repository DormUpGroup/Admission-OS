"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";

export function ShowAllMatches({
  count,
  children,
}: {
  count: number;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  if (count === 0) return null;
  if (!open) {
    return (
      <Button type="button" variant="outline" size="sm" onClick={() => setOpen(true)}>
        Показать все варианты ({count})
      </Button>
    );
  }
  return (
    <div className="space-y-3">
      <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(false)}>
        Скрыть все варианты
      </Button>
      {children}
    </div>
  );
}
