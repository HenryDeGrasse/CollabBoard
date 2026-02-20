import { useCallback, useMemo } from "react";
import type { BoardObject } from "../types/board";
import {
  isTextCapableObjectType,
  resolveObjectTextSize,
  clampTextSizeForType,
  getAutoContrastingTextColor,
} from "../utils/text-style";

type VAlign = "top" | "middle" | "bottom";

export interface UseTextStyleHandlersParams {
  selectedIds: Set<string>;
  objects: Record<string, BoardObject>;
  updateObject: (id: string, updates: Partial<BoardObject>) => void;
}

export interface UseTextStyleHandlersReturn {
  canEditSelectedText: boolean;
  selectedTextSize: number | null;
  selectedTextColor: string;
  selectedTextVerticalAlign: VAlign;
  handleAdjustSelectedTextSize: (delta: number) => void;
  handleChangeSelectedTextColor: (color: string) => void;
  handleChangeTextVerticalAlign: (align: VAlign) => void;
}

/**
 * Derives text-style state (size, color, vertical align) from the current
 * selection and provides handlers to change them. Extracted from BoardPage
 * to reduce its responsibilities.
 */
export function useTextStyleHandlers({
  selectedIds,
  objects,
  updateObject,
}: UseTextStyleHandlersParams): UseTextStyleHandlersReturn {
  const textStyleTargets = useMemo(() => {
    return Array.from(selectedIds)
      .map((id) => objects[id])
      .filter((obj): obj is BoardObject => Boolean(obj) && isTextCapableObjectType(obj.type));
  }, [selectedIds, objects]);

  const canEditSelectedText = textStyleTargets.length > 0;

  const selectedTextSize = useMemo(() => {
    const sizes = textStyleTargets.map((obj) => resolveObjectTextSize(obj));
    return sizes.length > 0 && sizes.every((s) => s === sizes[0]) ? sizes[0] : null;
  }, [textStyleTargets]);

  const selectedTextColor = useMemo(() => {
    const colors = textStyleTargets.map((obj) => {
      if (obj.textColor) return obj.textColor;
      if (obj.type === "frame") return "#374151";
      return getAutoContrastingTextColor(obj.color);
    });
    return colors.length > 0 ? colors[0] : "#111827";
  }, [textStyleTargets]);

  const selectedTextVerticalAlign: VAlign = useMemo(() => {
    const aligns = textStyleTargets.map((o) => o.textVerticalAlign ?? "middle");
    return aligns.length > 0 && aligns.every((a) => a === aligns[0])
      ? (aligns[0] as VAlign)
      : "middle";
  }, [textStyleTargets]);

  const handleAdjustSelectedTextSize = useCallback(
    (delta: number) => {
      selectedIds.forEach((id) => {
        const obj = objects[id];
        if (!obj || !isTextCapableObjectType(obj.type)) return;
        const base = resolveObjectTextSize(obj);
        const next = clampTextSizeForType(obj.type, base + delta);
        updateObject(id, { textSize: next });
      });
    },
    [selectedIds, objects, updateObject]
  );

  const handleChangeSelectedTextColor = useCallback(
    (color: string) => {
      selectedIds.forEach((id) => {
        const obj = objects[id];
        if (!obj || !isTextCapableObjectType(obj.type)) return;
        updateObject(id, { textColor: color });
      });
    },
    [selectedIds, objects, updateObject]
  );

  const handleChangeTextVerticalAlign = useCallback(
    (align: VAlign) => {
      selectedIds.forEach((id) => {
        const obj = objects[id];
        if (!obj || !isTextCapableObjectType(obj.type)) return;
        updateObject(id, { textVerticalAlign: align });
      });
    },
    [selectedIds, objects, updateObject]
  );

  return {
    canEditSelectedText,
    selectedTextSize,
    selectedTextColor,
    selectedTextVerticalAlign,
    handleAdjustSelectedTextSize,
    handleChangeSelectedTextColor,
    handleChangeTextVerticalAlign,
  };
}
