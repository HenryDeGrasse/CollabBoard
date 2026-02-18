import React, { useMemo, useRef } from "react";
import { Group, Rect, Text } from "react-konva";
import type { BoardObject } from "../../types/board";
import { ResizeHandles, computeResize, type ResizeHandle } from "./ResizeHandles";
import { calculateFontSize } from "../../utils/text-fit";
import {
  getAutoContrastingTextColor,
  resolveObjectTextSize,
} from "../../utils/text-style";

interface StickyNoteProps {
  object: BoardObject;
  isSelected: boolean;
  isEditing: boolean;
  isLockedByOther: boolean;
  lockedByName?: string;
  lockedByColor?: string;
  draftText?: string;
  onSelect: (id: string) => void;
  onDragStart: (id: string) => void;
  onDragMove: (id: string, x: number, y: number) => void;
  onDragEnd: (id: string, x: number, y: number) => void;
  onDoubleClick: (id: string) => void;
  onUpdateObject: (id: string, updates: Partial<BoardObject>) => void;
}

export const StickyNote = React.memo(function StickyNote({
  object,
  isSelected,
  isEditing,
  isLockedByOther,
  lockedByColor,
  draftText,
  onSelect,
  onDragStart,
  onDragMove,
  onDragEnd,
  onDoubleClick,
  onUpdateObject,
}: StickyNoteProps) {
  const groupRef = useRef<any>(null);
  const originalRef = useRef<{ x: number; y: number; width: number; height: number } | null>(null);

  const borderColor = isLockedByOther
    ? lockedByColor || "#EF4444"
    : isSelected
    ? "#4F46E5"
    : "rgba(0,0,0,0.15)";
  const borderWidth = isSelected || isLockedByOther ? 3 : 1;

  const PADDING = 12;

  // Auto-fit text size unless user explicitly overrides it.
  const fontSize = useMemo(() => {
    if (typeof object.textSize === "number") {
      return resolveObjectTextSize(object);
    }
    return calculateFontSize(object.text || "", object.width, object.height, PADDING, 10, 32);
  }, [object.type, object.text, object.width, object.height, object.textSize]);

  const textColor = useMemo(() => {
    if (object.textColor) return object.textColor;
    return getAutoContrastingTextColor(object.color);
  }, [object.color, object.textColor]);

  return (
    <Group
      id={`node-${object.id}`}
      ref={groupRef}
      x={object.x}
      y={object.y}
      draggable={!isEditing}
      onClick={() => onSelect(object.id)}
      onTap={() => onSelect(object.id)}
      onDblClick={() => onDoubleClick(object.id)}
      onDblTap={() => onDoubleClick(object.id)}
      onDragStart={() => onDragStart(object.id)}
      onDragMove={(e) => {
        onDragMove(object.id, e.target.x(), e.target.y());
      }}
      onDragEnd={(e) => {
        onDragEnd(object.id, e.target.x(), e.target.y());
      }}
      onMouseEnter={(e) => {
        if (isLockedByOther) {
          const container = e.target.getStage()?.container();
          if (container) container.style.cursor = "not-allowed";
        }
      }}
      onMouseLeave={(e) => {
        const container = e.target.getStage()?.container();
        if (container) container.style.cursor = "default";
      }}
    >
      {/* Shadow */}
      <Rect
        x={3}
        y={3}
        width={object.width}
        height={object.height}
        fill="rgba(0,0,0,0.1)"
        cornerRadius={4}
      />
      {/* Main body */}
      <Rect
        width={object.width}
        height={object.height}
        fill={object.color}
        cornerRadius={4}
        stroke={borderColor}
        strokeWidth={borderWidth}
      />
      {/* Fold effect */}
      <Rect
        x={0}
        y={0}
        width={object.width}
        height={6}
        fill="rgba(0,0,0,0.05)"
        cornerRadius={[4, 4, 0, 0]}
      />
      {/* Text - hidden while editing locally */}
      {!isEditing && (
        <Text
          x={PADDING}
          y={PADDING}
          width={object.width - PADDING * 2}
          height={object.height - PADDING * 2}
          text={draftText ?? object.text ?? ""}
          fontSize={fontSize}
          fontFamily="Inter, system-ui, sans-serif"
          fill={draftText ? (lockedByColor || "#6366F1") : textColor}
          fontStyle={draftText ? "italic" : "normal"}
          wrap="word"
          ellipsis
          verticalAlign="middle"
          align="center"
          opacity={draftText ? 0.7 : 1}
        />
      )}
      {/* Resize handles (only when selected, not editing) */}
      {isSelected && !isEditing && (
        <ResizeHandles
          object={object}
          circleMode={true}
          onResizeStart={() => {
            originalRef.current = { x: object.x, y: object.y, width: object.width, height: object.height };
          }}
          onResizeMove={(handle: ResizeHandle, px: number, py: number) => {
            if (!originalRef.current) return;
            const result = computeResize(originalRef.current, handle, px, py, 60, 60, true);
            onUpdateObject(object.id, result);
          }}
          onResizeEnd={() => {
            originalRef.current = null;
          }}
        />
      )}
    </Group>
  );
});
