"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { remindStudentDocumentsAction } from "@/server/actions";
import type { RemindDocumentItem } from "@/components/admin/remind-student-documents";

export function RemindStudentDocumentsBlock({
  studentId,
  items,
}: {
  studentId: string;
  items: RemindDocumentItem[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState("");
  const [selected, setSelected] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(items.map((item) => [item.documentId, true])),
  );

  const selectedIds = useMemo(
    () => items.filter((item) => selected[item.documentId]).map((item) => item.documentId),
    [items, selected],
  );
  const allSelected = items.length > 0 && selectedIds.length === items.length;

  if (items.length === 0) return null;

  function toggleAll(next: boolean) {
    setSelected(Object.fromEntries(items.map((item) => [item.documentId, next])));
  }

  function onRemind() {
    setError("");
    if (selectedIds.length === 0) {
      setError("Выберите хотя бы один документ");
      return;
    }
    const data = new FormData();
    data.set("studentId", studentId);
    for (const id of selectedIds) data.append("documentIds", id);
    startTransition(() => {
      void remindStudentDocumentsAction(data).then((result) => {
        if (result && "error" in result && result.error) {
          setError(result.error);
          return;
        }
        router.refresh();
      });
    });
  }

  return (
    <section className="rounded-lg border border-border px-4 py-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            Напомнить студенту
          </p>
          <p className="mt-1 text-[13px] text-muted-foreground">
            Выберите документы и отправьте одно напоминание.
          </p>
        </div>
        <Button
          type="button"
          size="sm"
          className="rounded-lg"
          disabled={pending || selectedIds.length === 0}
          onClick={onRemind}
        >
          {pending
            ? "…"
            : selectedIds.length > 0
              ? `Напомнить · ${selectedIds.length}`
              : "Напомнить"}
        </Button>
      </div>

      <div className="mt-3 space-y-1">
        <label className="flex cursor-pointer items-center gap-2.5 rounded-md px-1 py-1.5 text-[13px] hover:bg-muted/50">
          <Checkbox
            checked={allSelected}
            onCheckedChange={(value) => toggleAll(value === true)}
            aria-label="Выбрать все"
          />
          <span className="font-medium">Выбрать все</span>
        </label>
        <ul className="divide-y divide-border rounded-lg border border-border">
          {items.map((item) => (
            <li key={item.documentId}>
              <label className="flex cursor-pointer items-start gap-2.5 px-3 py-2.5 text-[13px] hover:bg-muted/40">
                <Checkbox
                  className="mt-0.5"
                  checked={Boolean(selected[item.documentId])}
                  onCheckedChange={(value) =>
                    setSelected((prev) => ({
                      ...prev,
                      [item.documentId]: value === true,
                    }))
                  }
                  aria-label={item.label}
                />
                <span className="min-w-0 leading-snug">{item.label}</span>
              </label>
            </li>
          ))}
        </ul>
      </div>
      {error ? (
        <p className="mt-2 text-[12px] text-[var(--danger-fg)]" role="alert">
          {error}
        </p>
      ) : null}
    </section>
  );
}
