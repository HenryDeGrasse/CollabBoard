import { useRef } from "react";
import { Group, Rect, Text } from "react-konva";
import type { BoardObject } from "../../types/board";
import { ResizeHandles, applyResize, type ResizeHandle } from "./ResizeHandles";

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
  const resizeStartRef = useRef<{ x: number; y: number; width: number; height: number } | null>(null);
  const TITLE_HEIGHT = 32;

  const handleResizeStart = (_id: string, _handle: ResizeHandle) => {
    resizeStartRef.current = {
      x: object.x,
      y: object.y,
      width: object.width,
      height: object.height,
    };
  };

  const handleResize = (_id: string, handle: ResizeHandle, dx: number, dy: number) => {
    if (!resizeStartRef.current) return;
    const result = applyResize(
      { ...object, ...resizeStartRef.current },
      handle,
      dx,
      dy,
      120,
      80
    );
    onUpdateObject(object.id, result);
  };

  const handleResizeEnd = (_id: string) => {
    resizeStartRef.current = null;
  };

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
          onResizeStart={handleResizeStart}
          onResize={handleResize}
          onResizeEnd={handleResizeEnd}
        />
      )}
    </Group>
  );
}
