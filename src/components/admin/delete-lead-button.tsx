"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { deleteLeadAction } from "@/server/lead-actions";

const UNDO_MS = 5000;

export function DeleteLeadButton({
  leadId,
  name,
  open: openProp,
  onOpenChange,
  showTrigger = true,
  startArmed = false,
  toastIndex = 0,
  onConfirmed,
  onUndo,
  onFailed,
  onDeleted,
}: {
  leadId: string;
  name: string;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  showTrigger?: boolean;
  /** Starts the undo countdown on mount, after the row is already gone. */
  startArmed?: boolean;
  toastIndex?: number;
  /** List takes the row away immediately and runs the countdown outside it. */
  onConfirmed?: () => void;
  onUndo?: () => void;
  onFailed?: (message: string) => void;
  onDeleted?: () => void;
}) {
  const router = useRouter();
  const onFailedRef = useRef(onFailed);
  const onDeletedRef = useRef(onDeleted);
  onFailedRef.current = onFailed;
  onDeletedRef.current = onDeleted;
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false);
  const open = openProp ?? uncontrolledOpen;

  function setOpen(next: boolean) {
    if (openProp === undefined) setUncontrolledOpen(next);
    onOpenChange?.(next);
  }
  const [undoUntil, setUndoUntil] = useState<number | null>(() =>
    startArmed ? Date.now() + UNDO_MS : null,
  );
  const [secondsLeft, setSecondsLeft] = useState(5);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (undoUntil == null) return;
    const tick = window.setInterval(() => {
      setSecondsLeft(Math.max(0, Math.ceil((undoUntil - Date.now()) / 1000)));
    }, 200);
    const timeout = window.setTimeout(() => {
      setPending(true);
      setError("");
      void deleteLeadAction(leadId)
        .then(() => {
          onDeletedRef.current?.();
          if (!onDeletedRef.current) router.push("/admin/leads");
          router.refresh();
        })
        .catch((caught: unknown) => {
          const message = caught instanceof Error ? caught.message : "Не удалось удалить лида";
          setPending(false);
          setUndoUntil(null);
          if (onFailedRef.current) {
            onFailedRef.current(message);
            return;
          }
          setError(message);
          setOpen(true);
        });
    }, Math.max(undoUntil - Date.now(), 0));
    return () => {
      window.clearInterval(tick);
      window.clearTimeout(timeout);
    };
  }, [undoUntil, leadId, router]);

  function close() {
    if (pending) return;
    setOpen(false);
    setError("");
  }

  function arm() {
    setOpen(false);
    setError("");
    if (onConfirmed) {
      onConfirmed();
      return;
    }
    setPending(false);
    setSecondsLeft(5);
    setUndoUntil(Date.now() + UNDO_MS);
  }

  function undo() {
    if (pending) return;
    setUndoUntil(null);
    setError("");
    onUndo?.();
  }

  return (
    <>
      {showTrigger ? (
        <Button type="button" size="sm" variant="outline" onClick={() => setOpen(true)} disabled={undoUntil != null}>
          Удалить лида
        </Button>
      ) : null}
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
              <Button type="button" variant="outline" onClick={close}>
                Отмена
              </Button>
              <Button type="button" variant="destructive" onClick={arm}>
                Удалить навсегда
              </Button>
            </div>
          </div>
        </div>
      ) : null}
      {undoUntil != null ? (
        <div
          className="fixed inset-x-0 z-50 flex justify-center px-4"
          style={{ bottom: `${16 + toastIndex * 72}px` }}
        >
          <div
            className="surface-card flex w-full max-w-md items-center justify-between gap-3 rounded-full px-4 py-3 shadow-lg"
            role="status"
          >
            <p className="text-[14px]">
              {pending ? "Удаляем…" : `Удаление через ${secondsLeft} с`}
            </p>
            {error ? (
              <p className="text-[13px] text-[var(--danger-fg)]" role="alert">
                {error}
              </p>
            ) : null}
            <Button type="button" size="sm" variant="outline" onClick={undo} disabled={pending}>
              Отменить
            </Button>
          </div>
        </div>
      ) : null}
    </>
  );
}
