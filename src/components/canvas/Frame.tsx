import { useRef } from "react";
import { Group, Rect, Text } from "react-konva";
import type { BoardObject } from "../../types/board";
import { ResizeHandles, computeResize, type ResizeHandle } from "./ResizeHandles";

interface FrameProps {
  object: BoardObject;
  isSelected: boolean;
  onSelect: (id: string) => void;
  onDragStart: (id: string) => void;
  onDragMove: (id: string, x: number, y: number) => void;
  onDragEnd: (id: string, x: number, y: number) => void;
  onDoubleClick: (id: string) => void;
  onUpdateObject: (id: string, updates: Partial<BoardObject>) => void;
}

export function Frame({
  object,
  isSelected,
  onSelect,
  onDragStart,
  onDragMove,
  onDragEnd,
  onDoubleClick,
  onUpdateObject,
}: FrameProps) {
  const groupRef = useRef<any>(null);
  const originalRef = useRef<{ x: number; y: number; width: number; height: number } | null>(null);
  const TITLE_HEIGHT = 32;

  return (
    <Group
      ref={groupRef}
      x={object.x}
      y={object.y}
      draggable
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
      {/* Frame border */}
      <Rect
        width={object.width}
        height={object.height}
        fill="rgba(249, 250, 251, 0.5)"
        stroke={isSelected ? "#4F46E5" : "#D1D5DB"}
        strokeWidth={isSelected ? 2 : 1}
        cornerRadius={8}
        dash={[6, 4]}
      />
      {/* Title bar */}
      <Rect
        width={object.width}
        height={TITLE_HEIGHT}
        fill={object.color || "#F3F4F6"}
        cornerRadius={[8, 8, 0, 0]}
      />
      {/* Title text */}
      <Text
        x={12}
        y={8}
        width={object.width - 24}
        text={object.text || "Frame"}
        fontSize={14}
        fontStyle="bold"
        fontFamily="Inter, system-ui, sans-serif"
        fill="#374151"
      />
      {/* Resize handles */}
      {isSelected && (
        <ResizeHandles
          object={object}
          onResizeStart={() => {
            originalRef.current = { x: object.x, y: object.y, width: object.width, height: object.height };
          }}
          onResizeMove={(handle: ResizeHandle, px: number, py: number) => {
            if (!originalRef.current) return;
            const result = computeResize(originalRef.current, handle, px, py, 120, 80);
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
