"use client";

import { useState } from "react";
import Link from "next/link";
import { EmptyState } from "@/components/empty-state";
import { PlatformPresenceBadge } from "@/components/platform-presence-badge";
import { LeadRowMenu } from "@/components/admin/lead-row-menu";
import { DeleteLeadButton } from "@/components/admin/delete-lead-button";
import { Button } from "@/components/ui/button";
import {
  DataTable,
  DataTableBody,
  DataTableCell,
  DataTableHead,
  DataTableHeader,
  DataTableRow,
} from "@/components/data-table";

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
  const [hiddenIds, setHiddenIds] = useState<string[]>([]);
  const [pending, setPending] = useState<Array<{ id: string; name: string }>>([]);
  const [error, setError] = useState("");

  const visible = rows.filter((row) => !hiddenIds.includes(row.id));

  function removeNow(row: LeadListRow) {
    setError("");
    setHiddenIds((ids) => (ids.includes(row.id) ? ids : [...ids, row.id]));
    setPending((list) => (list.some((item) => item.id === row.id) ? list : [...list, { id: row.id, name: row.title }]));
  }

  function restore(id: string) {
    setHiddenIds((ids) => ids.filter((item) => item !== id));
    setPending((list) => list.filter((item) => item.id !== id));
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
        <DataTable>
          <DataTableHeader>
            <DataTableRow>
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
            {visible.map((row) => (
              <DataTableRow key={row.id}>
                <DataTableCell className="font-medium">
                  <Link href={`/admin/leads/${row.id}`} className="hover:underline">
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
            ))}
          </DataTableBody>
        </DataTable>
      )}
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
          onDeleted={() => setPending((list) => list.filter((entry) => entry.id !== item.id))}
        />
      ))}
      {error ? (
        <div className="fixed inset-x-0 bottom-4 z-50 flex justify-center px-4">
          <div
            className="surface-card flex w-full max-w-md items-center justify-between gap-3 rounded-full px-4 py-3 shadow-lg"
            role="alert"
          >
            <p className="text-[14px] text-[var(--danger-fg)]">{error}</p>
            <Button type="button" size="sm" variant="outline" onClick={() => setError("")}>
              Закрыть
            </Button>
          </div>
        </div>
      ) : null}
    </>
  );
}
