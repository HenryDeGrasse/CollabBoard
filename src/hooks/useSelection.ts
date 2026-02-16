import { useState, useCallback } from "react";

export interface UseSelectionReturn {
  selectedIds: Set<string>;
  select: (id: string, multi?: boolean) => void;
  deselect: (id: string) => void;
  clearSelection: () => void;
  isSelected: (id: string) => boolean;
  selectMultiple: (ids: string[]) => void;
}

export function useSelection(): UseSelectionReturn {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

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
      return new Set([id]);
    });
  }, []);

  const deselect = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
  }, []);

  const clearSelection = useCallback(() => {
    setSelectedIds(new Set());
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
