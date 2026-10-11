"use client";

import { useMemo, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { BulkActionBar } from "@/components/bulk-action-bar";
import { StatusBadge } from "@/components/status-badge";
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
import { completeTaskAction } from "@/server/actions";
import { labelOf } from "@/lib/labels";
import { dueDateLabel, taskUrgency, type TaskUrgency } from "@/lib/task-sort";
import { cn, fullName } from "@/lib/utils";

export type TaskTableRow = {
  id: string;
  title: string;
  description: string | null;
  status: string;
  priority: string;
  dueDate: string | null;
  studentId: string;
  studentName: string;
};

export type TaskTableGroup = {
  key: string;
  label: string;
  rows: TaskTableRow[];
};

function PriorityCell({ priority }: { priority: string }) {
  if (priority === "URGENT" || priority === "HIGH") {
    return (
      <span
        className={cn(
          "inline-flex rounded-[var(--radius-badge)] px-1.5 py-0.5 text-[11px] font-medium",
          priority === "URGENT"
            ? "bg-[var(--danger-bg)] text-[var(--danger-fg)]"
            : "bg-[var(--warning-bg)] text-[var(--warning-fg)]",
        )}
      >
        {labelOf(priority)}
      </span>
    );
  }
  return (
    <span className="text-xs text-muted-foreground">{labelOf(priority)}</span>
  );
}

function urgencyRowClass(urgency: TaskUrgency) {
  if (urgency === "overdue") {
    return "border-l-[3px] border-l-[var(--danger)] bg-[var(--danger-bg)]/40";
  }
  if (urgency === "today") {
    return "border-l-[3px] border-l-[var(--warning)] bg-[var(--warning-bg)]/50";
  }
  return "border-l-[3px] border-l-transparent";
}

function TaskTableHeader({
  allSelected,
  someSelected,
  onToggleAll,
}: {
  allSelected: boolean;
  someSelected: boolean;
  onToggleAll: () => void;
}) {
  return (
    <DataTableHeader>
      <DataTableRow>
        <DataTableHead className="w-10">
          <SelectAllCheckbox
            checked={allSelected}
            indeterminate={someSelected}
            onToggle={onToggleAll}
          />
        </DataTableHead>
        <DataTableHead className="w-10" />
        <DataTableHead>Задача</DataTableHead>
        <DataTableHead>Студент</DataTableHead>
        <DataTableHead>Срок</DataTableHead>
        <DataTableHead>Приоритет</DataTableHead>
        <DataTableHead>Статус</DataTableHead>
      </DataTableRow>
    </DataTableHeader>
  );
}

function TaskRows({
  rows,
  isSelected,
  onToggle,
}: {
  rows: TaskTableRow[];
  isSelected: (id: string) => boolean;
  onToggle: (id: string) => void;
}) {
  return (
    <>
      {rows.map((task) => {
        const checked = isSelected(task.id);
        const dueDate = task.dueDate ? new Date(task.dueDate) : null;
        const urgency = taskUrgency({ dueDate, status: task.status });
        const due = dueDateLabel(dueDate);
        return (
          <DataTableRow
            key={task.id}
            data-state={checked ? "selected" : undefined}
            className={cn(
              "odd:bg-transparent",
              urgencyRowClass(urgency),
              checked && "bg-[var(--brand-soft)]/50",
            )}
          >
            <DataTableCell className="w-10">
              <RowSelectCheckbox
                checked={checked}
                onToggle={() => onToggle(task.id)}
                label={`Выбрать ${task.title}`}
              />
            </DataTableCell>
            <DataTableCell>
              {task.status !== "DONE" ? (
                <form action={completeTaskAction.bind(null, task.id)}>
                  <Button
                    type="submit"
                    size="sm"
                    variant="ghost"
                    title="Завершить"
                  >
                    ✓
                  </Button>
                </form>
              ) : null}
            </DataTableCell>
            <DataTableCell>
              <p className="font-medium text-foreground">{task.title}</p>
              {task.description ? (
                <p className="line-clamp-1 text-[11px] text-muted-foreground">
                  {task.description}
                </p>
              ) : null}
            </DataTableCell>
            <DataTableCell>
              <Link
                href={`/admin/students/${task.studentId}`}
                className="font-medium hover:underline"
              >
                {task.studentName}
              </Link>
            </DataTableCell>
            <DataTableCell
              className={cn("tabular-nums text-[12px]", due.className)}
            >
              {due.text}
            </DataTableCell>
            <DataTableCell>
              <PriorityCell priority={task.priority} />
            </DataTableCell>
            <DataTableCell>
              <StatusBadge status={task.status} kind="task" />
            </DataTableCell>
          </DataTableRow>
        );
      })}
    </>
  );
}

export function TasksTable({
  rows,
  groups,
}: {
  rows: TaskTableRow[];
  groups?: TaskTableGroup[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const allRows = useMemo(
    () => (groups ? groups.flatMap((group) => group.rows) : rows),
    [groups, rows],
  );
  const openIds = useMemo(
    () => allRows.filter((row) => row.status !== "DONE").map((row) => row.id),
    [allRows],
  );
  const selection = useRowSelection(allRows.map((row) => row.id));
  const selectedOpen = selection.selectedIds.filter((id) =>
    openIds.includes(id),
  );

  function completeSelected() {
    if (selectedOpen.length === 0) return;
    startTransition(async () => {
      for (const id of selectedOpen) {
        await completeTaskAction(id);
      }
      selection.clear();
      router.refresh();
    });
  }

  return (
    <>
      {groups ? (
        <div className="space-y-5">
          {groups.map((group) =>
            group.rows.length === 0 ? null : (
              <div key={group.key} className="space-y-2">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                  {group.label}
                  <span className="ml-1.5 font-normal tabular-nums">
                    ({group.rows.length})
                  </span>
                </p>
                <DataTable>
                  <TaskTableHeader
                    allSelected={selection.allSelected}
                    someSelected={selection.someSelected}
                    onToggleAll={selection.toggleAll}
                  />
                  <DataTableBody>
                    <TaskRows
                      rows={group.rows}
                      isSelected={selection.isSelected}
                      onToggle={selection.toggle}
                    />
                  </DataTableBody>
                </DataTable>
              </div>
            ),
          )}
        </div>
      ) : (
        <DataTable>
          <TaskTableHeader
            allSelected={selection.allSelected}
            someSelected={selection.someSelected}
            onToggleAll={selection.toggleAll}
          />
          <DataTableBody>
            <TaskRows
              rows={rows}
              isSelected={selection.isSelected}
              onToggle={selection.toggle}
            />
          </DataTableBody>
        </DataTable>
      )}

      <BulkActionBar count={selection.selectedCount} onClear={selection.clear}>
        <Button
          type="button"
          size="sm"
          disabled={pending || selectedOpen.length === 0}
          onClick={completeSelected}
        >
          {pending ? "Завершаем…" : `Завершить (${selectedOpen.length})`}
        </Button>
      </BulkActionBar>
    </>
  );
}

export function toTaskTableRow(task: {
  id: string;
  title: string;
  description: string | null;
  status: string;
  priority: string;
  dueDate: Date | null;
  studentId: string;
  student: { firstName: string; lastName: string };
}): TaskTableRow {
  return {
    id: task.id,
    title: task.title,
    description: task.description,
    status: task.status,
    priority: task.priority,
    dueDate: task.dueDate?.toISOString() ?? null,
    studentId: task.studentId,
    studentName: fullName(task.student.firstName, task.student.lastName),
  };
}
