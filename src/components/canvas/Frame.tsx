import { useMemo, useRef } from "react";
import { Group, Rect, Text, Line } from "react-konva";
import type { BoardObject } from "../../types/board";
import { ResizeHandles, computeResize, type ResizeHandle } from "./ResizeHandles";

interface FrameProps {
  object: BoardObject;
  isSelected: boolean;
  isEditing: boolean;
  containedCount: number;
  onSelect: (id: string, multi?: boolean) => void;
  onDragStart: (id: string) => void;
  onDragMove: (id: string, x: number, y: number) => void;
  onDragEnd: (id: string, x: number, y: number) => void;
  onDoubleClick: (id: string) => void;
  onUpdateObject: (id: string, updates: Partial<BoardObject>) => void;
}

const TITLE_HEIGHT = 32;
const MIN_WIDTH = 200;
const MIN_HEIGHT = 150;
const CORNER_RADIUS = 8;

export function Frame({
  object,
  isSelected,
  isEditing,
  containedCount,
  onSelect,
  onDragStart,
  onDragMove,
  onDragEnd,
  onDoubleClick,
  onUpdateObject,
}: FrameProps) {
  const groupRef = useRef<any>(null);
  const originalRef = useRef<{ x: number; y: number; width: number; height: number } | null>(null);

  const borderColor = isSelected ? "#4F46E5" : "#D1D5DB";
  const borderWidth = isSelected ? 2.5 : 1.5;

  // Title font size
  const titleFontSize = useMemo(() => {
    return Math.min(14, Math.max(10, object.width / 20));
  }, [object.width]);

  return (
    <Group
      id={`node-${object.id}`}
      ref={groupRef}
      x={object.x}
      y={object.y}
      draggable={!isEditing}
      onClick={(e) => {
        e.cancelBubble = true;
        onSelect(object.id, e.evt.shiftKey);
      }}
      onTap={(e) => {
        e.cancelBubble = true;
        onSelect(object.id);
      }}
      onDblClick={(e) => {
        e.cancelBubble = true;
        onDoubleClick(object.id);
      }}
      onDblTap={(e) => {
        e.cancelBubble = true;
        onDoubleClick(object.id);
      }}
      onDragStart={() => onDragStart(object.id)}
      onDragMove={(e) => onDragMove(object.id, e.target.x(), e.target.y())}
      onDragEnd={(e) => onDragEnd(object.id, e.target.x(), e.target.y())}
    >
      {/* Frame background — subtle, sits behind everything */}
      <Rect
        width={object.width}
        height={object.height}
        fill="rgba(248, 250, 252, 0.85)"
        stroke={borderColor}
        strokeWidth={borderWidth}
        cornerRadius={CORNER_RADIUS}
        dash={isSelected ? undefined : [6, 3]}
      />

      {/* Title bar background */}
      <Rect
        x={0}
        y={0}
        width={object.width}
        height={TITLE_HEIGHT}
        fill="rgba(241, 245, 249, 0.95)"
        cornerRadius={[CORNER_RADIUS, CORNER_RADIUS, 0, 0]}
      />

      {/* Title bar bottom border */}
      <Line
        points={[0, TITLE_HEIGHT, object.width, TITLE_HEIGHT]}
        stroke={borderColor}
        strokeWidth={1}
        opacity={0.5}
      />

      {/* Frame icon */}
      <Text
        x={10}
        y={TITLE_HEIGHT / 2 - 6}
        text="⊞"
        fontSize={12}
        fill="#94A3B8"
      />

      {/* Title text — hidden while editing */}
      {!isEditing && (
        <Text
          x={26}
          y={TITLE_HEIGHT / 2 - titleFontSize / 2}
          width={object.width - 80}
          text={object.text || "Frame"}
          fontSize={titleFontSize}
          fontFamily="Inter, system-ui, sans-serif"
          fontStyle="bold"
          fill="#475569"
          ellipsis
          wrap="none"
        />
      )}

      {/* Object count badge */}
      {containedCount > 0 && (
        <>
          <Rect
            x={object.width - 40}
            y={TITLE_HEIGHT / 2 - 9}
            width={30}
            height={18}
            fill="#E2E8F0"
            cornerRadius={9}
          />
          <Text
            x={object.width - 40}
            y={TITLE_HEIGHT / 2 - 6}
            width={30}
            text={String(containedCount)}
            fontSize={10}
            fontFamily="Inter, system-ui, sans-serif"
            fill="#64748B"
            align="center"
          />
        </>
      )}

      {/* Corner dots for visual flair */}
      <Rect
        x={6}
        y={object.height - 6}
        width={3}
        height={3}
        fill="#CBD5E1"
        cornerRadius={1}
      />
      <Rect
        x={object.width - 9}
        y={object.height - 6}
        width={3}
        height={3}
        fill="#CBD5E1"
        cornerRadius={1}
      />

      {/* Resize handles */}
      {isSelected && !isEditing && (
        <ResizeHandles
          object={object}
          circleMode={false}
          onResizeStart={() => {
            originalRef.current = {
              x: object.x,
              y: object.y,
              width: object.width,
              height: object.height,
            };
          }}
          onResizeMove={(handle: ResizeHandle, px: number, py: number) => {
            if (!originalRef.current) return;
            const result = computeResize(
              originalRef.current,
              handle,
              px,
              py,
              MIN_WIDTH,
              MIN_HEIGHT,
              false
            );
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
