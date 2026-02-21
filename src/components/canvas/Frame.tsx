import React, { useMemo, useRef } from "react";
import { Group, Rect, Text, Line } from "react-konva";
import Konva from "konva";
import type { BoardObject } from "../../types/board";
import { ResizeHandles, computeResize, type ResizeHandle } from "./ResizeHandles";
import {
  getFrameHeaderHeight,
  getFrameTitleFontSize,
} from "../../utils/text-style";

interface FrameProps {
  object: BoardObject;
  isSelected: boolean;
  isEditing: boolean;
  containedCount: number;
  isSelectMode: boolean;
  onSelect?: (id: string, multi?: boolean) => void;
  onDragStart?: (id: string) => void;
}

const MIN_WIDTH = 200;
const MIN_HEIGHT = 150;
const CORNER_RADIUS = 8;

export const Frame = React.memo(function Frame({
  object,
  isSelected,
  isEditing,
  containedCount,
  isSelectMode,
  onSelect,
  onDragStart,
}: FrameProps) {
  const groupRef = useRef<Konva.Group>(null);

  const borderColor = isSelected ? "#4F46E5" : "#94A3B8";
  const borderWidth = isSelected ? 2.5 : 2;

  const titleFontSize = useMemo(
    () => getFrameTitleFontSize(object),
    [object.width, object.textSize]
  );
  const titleHeight = useMemo(
    () => getFrameHeaderHeight(object),
    [object.width, object.textSize]
  );
  const titleColor = object.textColor || "#475569";

  return (
    <Group
      id={`node-${object.id}`}
      ref={groupRef}
      x={object.x}
      y={object.y}
      /* Frames are NOT Konva-draggable. All frame dragging is handled by
         useFrameInteraction (manual mouse-tracking via the FrameOverlay header).
         This prevents the dual-drag race condition. */
      draggable={false}
    >
      {/* Frame background — subtle, sits behind everything */}
      <Rect
        width={object.width}
        height={object.height}
        fill="#F9F9F7"
        stroke={borderColor}
        strokeWidth={borderWidth}
        cornerRadius={0}
        dash={isSelected ? undefined : [8, 4]}
        shadowColor="#111111"
        shadowBlur={0}
        shadowOffsetX={isSelected ? 4 : 0}
        shadowOffsetY={isSelected ? 4 : 0}
        listening={false}
      />

      {/* Body hitbox — allows selecting AND dragging the frame by clicking its
          empty background. Rendered behind children so child objects receive
          clicks first (children won't accidentally trigger a frame drag). */}
      <Rect
        x={0}
        y={titleHeight}
        width={object.width}
        height={Math.max(0, object.height - titleHeight)}
        fill="rgba(0,0,0,0)"
        listening={isSelectMode}
        onClick={(e) => {
          e.cancelBubble = true;
          onSelect?.(object.id, e.evt.shiftKey);
        }}
        onTap={(e) => {
          e.cancelBubble = true;
          onSelect?.(object.id);
        }}
        onMouseDown={(e) => {
          if (isSelectMode && isSelected) {
            e.cancelBubble = true;
            onDragStart?.(object.id);
          }
        }}
      />

      {/* Title bar background */}
      <Rect
        x={0}
        y={0}
        width={object.width}
        height={titleHeight}
        fill="#E5E5E0"
        cornerRadius={0}
        listening={false}
      />

      {/* Title bar bottom border */}
      <Line
        points={[0, titleHeight, object.width, titleHeight]}
        stroke={borderColor}
        strokeWidth={2}
        listening={false}
      />

      {/* Frame icon */}
      <Text
        x={10}
        y={titleHeight / 2 - 6}
        text="■"
        fontSize={12}
        fill="#111111"
        listening={false}
      />

      {/* Title text — hidden while editing */}
      {!isEditing && (
        <Text
          x={26}
          y={titleHeight / 2 - titleFontSize / 2}
          width={object.width - 80}
          text={object.text || "Frame"}
          fontSize={titleFontSize}
          fontFamily="'Playfair Display', serif"
          fontStyle="bold"
          fill={titleColor}
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
            y={titleHeight / 2 - 9}
            width={30}
            height={18}
            fill="#E2E8F0"
            cornerRadius={9}
            listening={false}
          />
          <Text
            x={object.width - 40}
            y={titleHeight / 2 - 6}
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
});

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
  onResizePreview?: (id: string, updates: Partial<BoardObject>) => void;
  onResizePreviewEnd?: (id: string) => void;
  onFrameResizeStart?: (id: string) => void;
  minFrameWidth?: number;
  minFrameHeight?: number;
}

export const FrameOverlay = React.memo(function FrameOverlay({
  object,
  isSelected,
  isEditing,
  containedCount,
  isSelectMode,
  onSelect,
  onDoubleClick,
  onDragStart,
  onUpdateObject,
  onResizePreview,
  onResizePreviewEnd,
  onFrameResizeStart,
  minFrameWidth,
  minFrameHeight,
}: FrameOverlayProps) {
  const originalRef = useRef<{
    x: number;
    y: number;
    width: number;
    height: number;
  } | null>(null);

  const titleFontSize = getFrameTitleFontSize(object);
  const titleHeight = getFrameHeaderHeight(object);
  const titleColor = object.textColor || "#475569";

  const effectiveMinWidth = minFrameWidth ?? MIN_WIDTH;
  const effectiveMinHeight = Math.max(
    minFrameHeight ?? MIN_HEIGHT,
    titleHeight + 40
  );
  const borderColor = isSelected ? "#4F46E5" : "#94A3B8";
  const borderWidth = isSelected ? 2.5 : 2;

  return (
    <Group x={object.x} y={object.y} listening={true}>
      {/* Border outline on top */}
      <Rect
        width={object.width}
        height={object.height}
        fill="transparent"
        stroke={borderColor}
        strokeWidth={borderWidth}
        cornerRadius={0}
        dash={isSelected ? undefined : [8, 4]}
        listening={false}
      />

      {/* Header bar background */}
      <Rect
        x={0}
        y={0}
        width={object.width}
        height={titleHeight}
        fill="#E5E5E0"
        cornerRadius={0}
        listening={false}
      />

      {/* Header bottom border */}
      <Line
        points={[0, titleHeight, object.width, titleHeight]}
        stroke={borderColor}
        strokeWidth={2}
        listening={false}
      />

      {/* Frame icon */}
      <Text
        x={10}
        y={titleHeight / 2 - 6}
        text="■"
        fontSize={12}
        fill="#111111"
        listening={false}
      />

      {/* Title text — hidden while editing */}
      {!isEditing && (
        <Text
          x={26}
          y={titleHeight / 2 - titleFontSize / 2}
          width={object.width - 80}
          text={object.text || "Frame"}
          fontSize={titleFontSize}
          fontFamily="'Playfair Display', serif"
          fontStyle="bold"
          fill={titleColor}
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
            y={titleHeight / 2 - 9}
            width={30}
            height={18}
            fill="#E2E8F0"
            cornerRadius={9}
            listening={false}
          />
          <Text
            x={object.width - 40}
            y={titleHeight / 2 - 6}
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
        height={titleHeight}
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
            onFrameResizeStart?.(object.id);
          }}
          onResizeMove={(handle: ResizeHandle, px: number, py: number) => {
            if (!originalRef.current) return;
            const result = computeResize(
              originalRef.current,
              handle,
              px,
              py,
              effectiveMinWidth,
              effectiveMinHeight,
              false
            );
            onUpdateObject(object.id, result);
            onResizePreview?.(object.id, result);
          }}
          onResizeEnd={() => {
            originalRef.current = null;
            onResizePreviewEnd?.(object.id);
          }}
        />
      )}
    </Group>
  );
});

