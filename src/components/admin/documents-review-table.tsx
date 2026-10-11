"use client";

import { useMemo, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { BulkActionBar } from "@/components/bulk-action-bar";
import { DocumentStatusBadge } from "@/components/document-status-badge";
import {
  RowSelectCheckbox,
  SelectAllCheckbox,
} from "@/components/row-select-checkbox";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  DataTable,
  DataTableBody,
  DataTableCell,
  DataTableHead,
  DataTableHeader,
  DataTableRow,
} from "@/components/data-table";
import { useRowSelection } from "@/hooks/use-row-selection";
import {
  approveDocumentAction,
  needsChangesAction,
} from "@/server/actions";
import { cn, formatDate, fullName } from "@/lib/utils";

export type DocumentReviewRow = {
  id: string;
  name: string;
  status: string;
  fileUrl: string | null;
  uploadedAt: string | null;
  studentId: string;
  studentName: string;
  related: string[];
  canReview: boolean;
};

export function DocumentsReviewTable({ rows }: { rows: DocumentReviewRow[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const reviewableIds = useMemo(
    () => rows.filter((row) => row.canReview).map((row) => row.id),
    [rows],
  );
  const selection = useRowSelection(rows.map((row) => row.id));
  const selectedReviewable = selection.selectedIds.filter((id) =>
    reviewableIds.includes(id),
  );

  function approveSelected() {
    if (selectedReviewable.length === 0) return;
    startTransition(async () => {
      for (const id of selectedReviewable) {
        await approveDocumentAction(id);
      }
      selection.clear();
      router.refresh();
    });
  }

  return (
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
            <DataTableHead>Студент</DataTableHead>
            <DataTableHead>Документ</DataTableHead>
            <DataTableHead>Загружен</DataTableHead>
            <DataTableHead>Связано</DataTableHead>
            <DataTableHead>Статус</DataTableHead>
            <DataTableHead>Действие</DataTableHead>
          </DataTableRow>
        </DataTableHeader>
        <DataTableBody>
          {rows.map((doc) => {
            const checked = selection.isSelected(doc.id);
            return (
              <DataTableRow
                key={doc.id}
                data-state={checked ? "selected" : undefined}
                className={cn(checked && "bg-[var(--brand-soft)]/50")}
              >
                <DataTableCell className="w-10">
                  <RowSelectCheckbox
                    checked={checked}
                    onToggle={() => selection.toggle(doc.id)}
                    label={`Выбрать ${doc.name}`}
                  />
                </DataTableCell>
                <DataTableCell>
                  <Link
                    href={`/admin/students/${doc.studentId}`}
                    className="font-medium hover:underline"
                  >
                    {doc.studentName}
                  </Link>
                </DataTableCell>
                <DataTableCell>
                  <div className="flex flex-col gap-0.5">
                    <span className="font-medium">{doc.name}</span>
                    {doc.fileUrl ? (
                      <a
                        href={doc.fileUrl}
                        className="text-[11px] text-[var(--brand-fg)] hover:underline"
                        target="_blank"
                        rel="noreferrer"
                      >
                        Открыть файл
                      </a>
                    ) : null}
                  </div>
                </DataTableCell>
                <DataTableCell className="tabular-nums text-muted-foreground">
                  {doc.uploadedAt ? formatDate(doc.uploadedAt) : "—"}
                </DataTableCell>
                <DataTableCell className="max-w-[200px] text-xs text-muted-foreground">
                  {doc.related.length ? doc.related.join(", ") : "—"}
                </DataTableCell>
                <DataTableCell>
                  <DocumentStatusBadge status={doc.status} />
                </DataTableCell>
                <DataTableCell>
                  {doc.canReview ? (
                    <div className="flex flex-col gap-2">
                      <form action={approveDocumentAction.bind(null, doc.id)}>
                        <Button type="submit" size="sm" variant="secondary">
                          Одобрить
                        </Button>
                      </form>
                      <form action={needsChangesAction} className="flex gap-1">
                        <input type="hidden" name="documentId" value={doc.id} />
                        <Input
                          name="reason"
                          placeholder="Причина…"
                          className="h-7 w-36"
                          required
                        />
                        <Button type="submit" size="sm" variant="outline">
                          Нужны правки
                        </Button>
                      </form>
                    </div>
                  ) : (
                    <Link
                      href={`/admin/students/${doc.studentId}?tab=documents`}
                      className="text-xs text-muted-foreground hover:underline"
                    >
                      Открыть хранилище
                    </Link>
                  )}
                </DataTableCell>
              </DataTableRow>
            );
          })}
        </DataTableBody>
      </DataTable>

      <BulkActionBar count={selection.selectedCount} onClear={selection.clear}>
        <Button
          type="button"
          size="sm"
          disabled={pending || selectedReviewable.length === 0}
          onClick={approveSelected}
        >
          {pending
            ? "Одобряем…"
            : `Одобрить (${selectedReviewable.length})`}
        </Button>
      </BulkActionBar>
    </>
  );
}

export function toDocumentReviewRow(doc: {
  id: string;
  name: string;
  status: string;
  fileUrl: string | null;
  uploadedAt: Date | null;
  studentId: string;
  student: { firstName: string; lastName: string };
  requirements: Array<{
    application: {
      program: { name: string; university: { name: string } };
    };
  }>;
}): DocumentReviewRow {
  return {
    id: doc.id,
    name: doc.name,
    status: doc.status,
    fileUrl: doc.fileUrl,
    uploadedAt: doc.uploadedAt?.toISOString() ?? null,
    studentId: doc.studentId,
    studentName: fullName(doc.student.firstName, doc.student.lastName),
    related: [
      ...new Set(
        doc.requirements.map(
          (r) =>
            `${r.application.program.university.name} — ${r.application.program.name}`,
        ),
      ),
    ],
    canReview: doc.status === "UPLOADED" || doc.status === "UNDER_REVIEW",
  };
}
