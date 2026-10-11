"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { EmptyState } from "@/components/empty-state";
import { PlatformPresenceBadge } from "@/components/platform-presence-badge";
import { LeadRowMenu } from "@/components/admin/lead-row-menu";
import { DeleteLeadButton } from "@/components/admin/delete-lead-button";
import { BulkActionBar } from "@/components/bulk-action-bar";
import {
  RowSelectCheckbox,
  SelectAllCheckbox,
} from "@/components/row-select-checkbox";
import { Button } from "@/components/ui/button";
import {
  DataTable,
  DataTableBody,
  DataTableCell,
  DataTableHead,
  DataTableHeader,
  DataTableRow,
} from "@/components/data-table";
import { useRowSelection } from "@/hooks/use-row-selection";
import { deleteLeadsAction } from "@/server/lead-actions";
import { cn } from "@/lib/utils";

export type LeadListRow = {
  id: string;
  title: string;
  channel: string;
  contact: string;
  curator: string;
  activity: string;
  conversationId: string | null;
};

export function LeadsTable({ rows, query }: { rows: LeadListRow[]; query: string }) {
  const router = useRouter();
  const [hiddenIds, setHiddenIds] = useState<string[]>([]);
  const [pending, setPending] = useState<Array<{ id: string; name: string }>>([]);
  const [error, setError] = useState("");
  const [confirmBulk, setConfirmBulk] = useState(false);
  const [bulkPending, startBulk] = useTransition();

  const visible = useMemo(
    () => rows.filter((row) => !hiddenIds.includes(row.id)),
    [rows, hiddenIds],
  );
  const visibleIds = useMemo(() => visible.map((row) => row.id), [visible]);
  const selection = useRowSelection(visibleIds);

  function removeNow(row: LeadListRow) {
    setError("");
    selection.clear();
    setHiddenIds((ids) => (ids.includes(row.id) ? ids : [...ids, row.id]));
    setPending((list) =>
      list.some((item) => item.id === row.id)
        ? list
        : [...list, { id: row.id, name: row.title }],
    );
  }

  function restore(id: string) {
    setHiddenIds((ids) => ids.filter((item) => item !== id));
    setPending((list) => list.filter((item) => item.id !== id));
  }

  function runBulkDelete() {
    const ids = selection.selectedIds;
    if (ids.length === 0) return;
    setConfirmBulk(false);
    setError("");
    startBulk(async () => {
      const result = await deleteLeadsAction(ids);
      selection.clear();
      if (result.failed.length > 0) {
        setError(
          result.deleted > 0
            ? `Удалено: ${result.deleted}. Не удалось: ${result.failed.length}.`
            : result.failed[0]?.error || "Не удалось удалить выбранных лидов",
        );
      }
      router.refresh();
    });
  }

  return (
    <>
      {visible.length === 0 ? (
        <EmptyState
          title={query ? "Ничего не найдено" : "Пока нет лидов"}
          description={
            query
              ? "Попробуйте другое имя или контакт."
              : "Когда человек напишет и ещё не станет учеником, он появится здесь."
          }
        />
      ) : (
        <>
          <DataTable>
            <DataTableHeader>
              <DataTableRow>
                <DataTableHead className="w-10">
                  <SelectAllCheckbox
                    checked={selection.allSelected}
                    indeterminate={selection.someSelected}
                    onToggle={selection.toggleAll}
                  />
                </DataTableHead>
                <DataTableHead>Человек</DataTableHead>
                <DataTableHead>Кабинет</DataTableHead>
                <DataTableHead>Канал</DataTableHead>
                <DataTableHead>Контакт</DataTableHead>
                <DataTableHead>Куратор</DataTableHead>
                <DataTableHead>Активность</DataTableHead>
                <DataTableHead />
              </DataTableRow>
            </DataTableHeader>
            <DataTableBody>
              {visible.map((row) => {
                const checked = selection.isSelected(row.id);
                return (
                  <DataTableRow
                    key={row.id}
                    data-state={checked ? "selected" : undefined}
                    className={cn(checked && "bg-[var(--brand-soft)]/50")}
                  >
                    <DataTableCell className="w-10">
                      <RowSelectCheckbox
                        checked={checked}
                        onToggle={() => selection.toggle(row.id)}
                        label={`Выбрать ${row.title}`}
                      />
                    </DataTableCell>
                    <DataTableCell className="font-medium">
                      <Link
                        href={`/admin/leads/${row.id}`}
                        className="hover:underline"
                      >
                        {row.title}
                      </Link>
                    </DataTableCell>
                    <DataTableCell>
                      <PlatformPresenceBadge hasAccount={false} />
                    </DataTableCell>
                    <DataTableCell>{row.channel}</DataTableCell>
                    <DataTableCell>{row.contact}</DataTableCell>
                    <DataTableCell>{row.curator}</DataTableCell>
                    <DataTableCell>{row.activity}</DataTableCell>
                    <DataTableCell className="w-12 text-right">
                      <LeadRowMenu
                        leadId={row.id}
                        name={row.title}
                        conversationId={row.conversationId}
                        onRemove={() => removeNow(row)}
                      />
                    </DataTableCell>
                  </DataTableRow>
                );
              })}
            </DataTableBody>
          </DataTable>

          <BulkActionBar
            count={selection.selectedCount}
            onClear={selection.clear}
          >
            <Button
              type="button"
              size="sm"
              variant="destructive"
              disabled={bulkPending}
              onClick={() => setConfirmBulk(true)}
            >
              Удалить выбранных
            </Button>
          </BulkActionBar>
        </>
      )}

      {confirmBulk ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4"
          role="presentation"
          onClick={() => !bulkPending && setConfirmBulk(false)}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="bulk-delete-leads-title"
            className="w-full max-w-md rounded-[var(--radius-card)] border border-border bg-card p-6 shadow-[var(--shadow-card-hover)]"
            onClick={(event) => event.stopPropagation()}
          >
            <h2
              id="bulk-delete-leads-title"
              className="text-[18px] font-semibold tracking-tight"
            >
              Удалить {selection.selectedCount}{" "}
              {selection.selectedCount === 1 ? "лида" : "лидов"}?
            </h2>
            <p className="mt-2 text-[14px] text-[var(--text-secondary)]">
              Пропадут карточки, переписка в Telegram и записи на консультации.
              Восстановить это нельзя.
            </p>
            <div className="mt-5 flex justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                disabled={bulkPending}
                onClick={() => setConfirmBulk(false)}
              >
                Отмена
              </Button>
              <Button
                type="button"
                variant="destructive"
                disabled={bulkPending}
                onClick={runBulkDelete}
              >
                {bulkPending ? "Удаляем…" : "Удалить навсегда"}
              </Button>
            </div>
          </div>
        </div>
      ) : null}

      {pending.map((item, index) => (
        <DeleteLeadButton
          key={item.id}
          leadId={item.id}
          name={item.name}
          showTrigger={false}
          startArmed
          toastIndex={index}
          onUndo={() => restore(item.id)}
          onFailed={(message) => {
            restore(item.id);
            setError(message);
          }}
          onDeleted={() =>
            setPending((list) => list.filter((entry) => entry.id !== item.id))
          }
        />
      ))}
      {error ? (
        <div className="fixed inset-x-0 bottom-4 z-50 flex justify-center px-4">
          <div
            className="flex w-full max-w-md items-center justify-between gap-3 rounded-[var(--radius-card)] border border-border bg-card px-4 py-3 shadow-lg"
            role="alert"
          >
            <p className="text-[14px] text-[var(--danger-fg)]">{error}</p>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => setError("")}
            >
              Закрыть
            </Button>
          </div>
        </div>
      ) : null}
    </>
  );
}
