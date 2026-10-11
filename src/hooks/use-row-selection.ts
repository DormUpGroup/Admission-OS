"use client";

import { useCallback, useMemo, useState } from "react";

export function useRowSelection(rowIds: string[]) {
  const [selected, setSelected] = useState<Set<string>>(() => new Set());

  const idSet = useMemo(() => new Set(rowIds), [rowIds]);

  const selectedIds = useMemo(
    () => [...selected].filter((id) => idSet.has(id)),
    [selected, idSet],
  );

  const selectedCount = selectedIds.length;
  const allSelected = rowIds.length > 0 && selectedCount === rowIds.length;
  const someSelected = selectedCount > 0 && !allSelected;

  const isSelected = useCallback((id: string) => selected.has(id), [selected]);

  const toggle = useCallback((id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const toggleAll = useCallback(() => {
    setSelected((prev) => {
      const everyVisibleSelected =
        rowIds.length > 0 && rowIds.every((id) => prev.has(id));
      if (everyVisibleSelected) return new Set();
      return new Set(rowIds);
    });
  }, [rowIds]);

  const clear = useCallback(() => setSelected(new Set()), []);

  const setMany = useCallback((ids: string[]) => {
    setSelected(new Set(ids));
  }, []);

  return {
    selectedIds,
    selectedCount,
    allSelected,
    someSelected,
    isSelected,
    toggle,
    toggleAll,
    clear,
    setMany,
  };
}
