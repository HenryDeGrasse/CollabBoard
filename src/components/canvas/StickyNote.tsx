import { useMemo, useRef } from "react";
import { Group, Rect, Text } from "react-konva";
import type { BoardObject } from "../../types/board";
import { ResizeHandles, computeResize, type ResizeHandle } from "./ResizeHandles";
import { calculateFontSize } from "../../utils/text-fit";

interface StickyNoteProps {
  object: BoardObject;
  isSelected: boolean;
  isEditing: boolean;
  isLockedByOther: boolean;
  lockedByName?: string;
  lockedByColor?: string;
  onSelect: (id: string) => void;
  onDragStart: (id: string) => void;
  onDragMove: (id: string, x: number, y: number) => void;
  onDragEnd: (id: string, x: number, y: number) => void;
  onDoubleClick: (id: string) => void;
  onUpdateObject: (id: string, updates: Partial<BoardObject>) => void;
}

export function StickyNote({
  object,
  isSelected,
  isEditing,
  isLockedByOther,
  lockedByColor,
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
    : "transparent";
  const borderWidth = isSelected || isLockedByOther ? 3 : 0;

  const PADDING = 12;

  // Auto-fit font size
  const fontSize = useMemo(
    () => calculateFontSize(object.text || "", object.width, object.height, PADDING, 10, 32),
    [object.text, object.width, object.height]
  );

  // Auto text color based on background luminance
  const textColor = useMemo(() => {
    const hex = object.color.replace("#", "");
    if (hex.length < 6) return "#1F2937";
    const r = parseInt(hex.substring(0, 2), 16);
    const g = parseInt(hex.substring(2, 4), 16);
    const b = parseInt(hex.substring(4, 6), 16);
    const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
    return luminance > 0.5 ? "#1F2937" : "#FFFFFF";
  }, [object.color]);

  return (
    <Group
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
      {/* Text - hidden while editing */}
      {!isEditing && (
        <Text
          x={PADDING}
          y={PADDING}
          width={object.width - PADDING * 2}
          height={object.height - PADDING * 2}
          text={object.text || ""}
          fontSize={fontSize}
          fontFamily="Inter, system-ui, sans-serif"
          fill={textColor}
          wrap="word"
          ellipsis
          verticalAlign="middle"
          align="center"
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
}
