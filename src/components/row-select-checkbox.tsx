"use client";

import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";

export function SelectAllCheckbox({
  checked,
  indeterminate,
  onToggle,
  label = "Выбрать все",
}: {
  checked: boolean;
  indeterminate?: boolean;
  onToggle: () => void;
  label?: string;
}) {
  return (
    <Checkbox
      checked={indeterminate ? "indeterminate" : checked}
      onCheckedChange={() => onToggle()}
      aria-label={label}
      className={cn(indeterminate && "opacity-90")}
    />
  );
}

export function RowSelectCheckbox({
  checked,
  onToggle,
  label,
}: {
  checked: boolean;
  onToggle: () => void;
  label: string;
}) {
  return (
    <Checkbox
      checked={checked}
      onCheckedChange={() => onToggle()}
      aria-label={label}
      onClick={(event) => event.stopPropagation()}
    />
  );
}
