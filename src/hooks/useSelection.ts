import { useState, useCallback } from "react";

export interface UseSelectionReturn {
  selectedIds: Set<string>;
  select: (id: string, multi?: boolean) => void;
  deselect: (id: string) => void;
  clearSelection: () => void;
  isSelected: (id: string) => boolean;
  selectMultiple: (ids: string[]) => void;
}

const EMPTY_SET = new Set<string>();

export function useSelection(): UseSelectionReturn {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(EMPTY_SET);

  const select = useCallback((id: string, multi = false) => {
    setSelectedIds((prev) => {
      if (multi) {
        const next = new Set(prev);
        if (next.has(id)) {
          next.delete(id);
        } else {
          next.add(id);
        }
        return next;
      }
      // Single select: if already exactly this one item, keep same ref
      if (prev.size === 1 && prev.has(id)) return prev;
      return new Set([id]);
    });
  }, []);

  const deselect = useCallback((id: string) => {
    setSelectedIds((prev) => {
      if (!prev.has(id)) return prev;
      const next = new Set(prev);
      next.delete(id);
      return next.size === 0 ? EMPTY_SET : next;
    });
  }, []);

  const clearSelection = useCallback(() => {
    setSelectedIds((prev) => (prev.size === 0 ? prev : EMPTY_SET));
  }, []);

  const isSelected = useCallback(
    (id: string) => selectedIds.has(id),
    [selectedIds]
  );

  const selectMultiple = useCallback((ids: string[]) => {
    setSelectedIds(new Set(ids));
  }, []);

  return {
    selectedIds,
    select,
    deselect,
    clearSelection,
    isSelected,
    selectMultiple,
  };
}
