"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { deleteLeadAction } from "@/server/lead-actions";

export function DeleteLeadButton({ leadId, name }: { leadId: string; name: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  function close() {
    if (pending) return;
    setOpen(false);
    setError("");
  }

  function remove() {
    if (pending) return;
    setPending(true);
    setError("");
    void deleteLeadAction(leadId)
      .then(() => {
        router.push("/admin/leads");
        router.refresh();
      })
      .catch((caught: unknown) => {
        setError(caught instanceof Error ? caught.message : "Не удалось удалить лида");
        setPending(false);
      });
  }

  return (
    <>
      <Button type="button" size="sm" variant="outline" onClick={() => setOpen(true)}>
        Удалить лида
      </Button>
      {open ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4"
          role="presentation"
          onClick={close}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="delete-lead-title"
            className="surface-card w-full max-w-md rounded-[28px] p-6"
            onClick={(event) => event.stopPropagation()}
            onKeyDown={(event) => {
              if (event.key === "Escape") close();
            }}
          >
            <h2 id="delete-lead-title" className="text-[20px] font-semibold tracking-tight">
              Удалить {name}?
            </h2>
            <p className="mt-2 text-[14px] text-muted-foreground">
              Пропадёт карточка, переписка в Telegram и записи на консультации. Восстановить это
              нельзя.
            </p>
            {error ? (
              <p className="mt-3 text-[13px] text-[var(--danger-fg)]" role="alert">
                {error}
              </p>
            ) : null}
            <div className="mt-5 flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={close} disabled={pending}>
                Отмена
              </Button>
              <Button type="button" variant="destructive" disabled={pending} onClick={remove}>
                {pending ? "Удаляем…" : "Удалить навсегда"}
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
