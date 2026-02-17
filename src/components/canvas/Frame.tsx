import { useMemo, useRef } from "react";
import { Group, Rect, Text, Line } from "react-konva";
import type { BoardObject } from "../../types/board";
import { ResizeHandles, computeResize, type ResizeHandle } from "./ResizeHandles";

interface FrameProps {
  object: BoardObject;
  isSelected: boolean;
  isEditing: boolean;
  containedCount: number;
  isSelectMode: boolean;
  onDragStart: (id: string) => void;
  onDragMove: (id: string, x: number, y: number) => void;
  onDragEnd: (id: string, x: number, y: number) => void;
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
  isSelectMode,
  onDragStart,
  onDragMove,
  onDragEnd,
}: FrameProps) {
  const groupRef = useRef<any>(null);

  const borderColor = isSelected ? "#4F46E5" : "#94A3B8";
  const borderWidth = isSelected ? 2.5 : 2;

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
      draggable={isSelected && isSelectMode && !isEditing}
      onDragStart={() => onDragStart(object.id)}
      onDragMove={(e) => onDragMove(object.id, e.target.x(), e.target.y())}
      onDragEnd={(e) => onDragEnd(object.id, e.target.x(), e.target.y())}
    >
      {/* Frame background — subtle, sits behind everything */}
      <Rect
        width={object.width}
        height={object.height}
        fill="rgba(248, 250, 252, 0.95)"
        stroke={borderColor}
        strokeWidth={borderWidth}
        cornerRadius={CORNER_RADIUS}
        dash={isSelected ? undefined : [8, 4]}
        shadowColor="rgba(0, 0, 0, 0.12)"
        shadowBlur={8}
        shadowOffsetX={0}
        shadowOffsetY={2}
        listening={false}
      />

      {/* Title bar background */}
      <Rect
        x={0}
        y={0}
        width={object.width}
        height={TITLE_HEIGHT}
        fill="rgba(241, 245, 249, 0.95)"
        cornerRadius={[CORNER_RADIUS, CORNER_RADIUS, 0, 0]}
        listening={false}
      />



      {/* Title bar bottom border */}
      <Line
        points={[0, TITLE_HEIGHT, object.width, TITLE_HEIGHT]}
        stroke={borderColor}
        strokeWidth={1}
        opacity={0.5}
        listening={false}
      />

      {/* Frame icon */}
      <Text
        x={10}
        y={TITLE_HEIGHT / 2 - 6}
        text="⊞"
        fontSize={12}
        fill="#94A3B8"
        listening={false}
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
          listening={false}
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
            listening={false}
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
            listening={false}
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
        listening={false}
      />
      <Rect
        x={object.width - 9}
        y={object.height - 6}
        width={3}
        height={3}
        fill="#CBD5E1"
        cornerRadius={1}
        listening={false}
      />


    </Group>
  );
}

// ─── Frame Overlay (renders on top of all objects) ─────────────

interface FrameOverlayProps {
  object: BoardObject;
  isSelected: boolean;
  isEditing: boolean;
  containedCount: number;
  isSelectMode: boolean;
  onSelect: (id: string, multi?: boolean) => void;
  onDoubleClick: (id: string) => void;
  onDragStart: (id: string) => void;
  onUpdateObject: (id: string, updates: Partial<BoardObject>) => void;
}

export function FrameOverlay({ object, isSelected, isEditing, containedCount, isSelectMode, onSelect, onDoubleClick, onDragStart, onUpdateObject }: FrameOverlayProps) {
  const originalRef = useRef<{ x: number; y: number; width: number; height: number } | null>(null);
  const borderColor = isSelected ? "#4F46E5" : "#94A3B8";
  const borderWidth = isSelected ? 2.5 : 2;

  const titleFontSize = Math.min(14, Math.max(10, object.width / 20));

  return (
    <Group x={object.x} y={object.y} listening={true}>
      {/* Border outline on top */}
      <Rect
        width={object.width}
        height={object.height}
        fill="transparent"
        stroke={borderColor}
        strokeWidth={borderWidth}
        cornerRadius={CORNER_RADIUS}
        dash={isSelected ? undefined : [8, 4]}
        listening={false}
      />

      {/* Header bar background */}
      <Rect
        x={0}
        y={0}
        width={object.width}
        height={TITLE_HEIGHT}
        fill="rgba(241, 245, 249, 0.98)"
        cornerRadius={[CORNER_RADIUS, CORNER_RADIUS, 0, 0]}
        listening={false}
      />

      {/* Header bottom border */}
      <Line
        points={[0, TITLE_HEIGHT, object.width, TITLE_HEIGHT]}
        stroke={borderColor}
        strokeWidth={1}
        opacity={0.5}
        listening={false}
      />

      {/* Frame icon */}
      <Text
        x={10}
        y={TITLE_HEIGHT / 2 - 6}
        text="⊞"
        fontSize={12}
        fill="#94A3B8"
        listening={false}
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
          listening={false}
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
            listening={false}
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
            listening={false}
          />
        </>
      )}

      {/* Interactive header hitbox (on top for selection/drag) */}
      <Rect
        x={0}
        y={0}
        width={object.width}
        height={TITLE_HEIGHT}
        fill="rgba(0,0,0,0)"
        listening={isSelectMode}
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
        onMouseDown={(e) => {
          if (isSelectMode && isSelected) {
            e.cancelBubble = true;
            onDragStart(object.id);
          }
        }}
      />

      {/* Resize handles (render on top of border) */}
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
