import React, { useMemo, useRef } from "react";
import { Group, Rect, Circle, Line, Text } from "react-konva";
import Konva from "konva";
import type { BoardObject } from "../../types/board";
import { ResizeHandles, computeResize, type ResizeHandle } from "./ResizeHandles";
import { RotationHandle } from "./RotationHandle";
import { calculateFontSize } from "../../utils/text-fit";
import {
  getAutoContrastingTextColor,
  resolveObjectTextSize,
} from "../../utils/text-style";

interface ShapeProps {
  object: BoardObject;
  isSelected: boolean;
  isEditing: boolean;
  isLockedByOther: boolean;
  lockedByColor?: string;
  draftText?: string;
  /** True when arrow tool is hovering over this object */
  isArrowHover?: boolean;
  /** Whether objects can be interacted with (select mode) */
  interactable?: boolean;
  onSelect: (id: string) => void;
  onDragStart: (id: string) => void;
  onDragMove: (id: string, x: number, y: number) => void;
  onDragEnd: (id: string, x: number, y: number) => void;
  onDoubleClick: (id: string) => void;
  onUpdateObject: (id: string, updates: Partial<BoardObject>) => void;
  onRotateStart?: (id: string) => void;
  onRotateMove?: (id: string, angle: number) => void;
  onRotateEnd?: (id: string, angle: number) => void;
}

export const Shape = React.memo(function Shape({
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
  isArrowHover,
  interactable = true,
  onRotateStart,
  onRotateMove,
  onRotateEnd,
}: ShapeProps) {
  const groupRef = useRef<Konva.Group>(null);
  const originalRef = useRef<{ x: number; y: number; width: number; height: number } | null>(null);

  const borderColor = isLockedByOther
    ? lockedByColor || "#EF4444"
    : isSelected
    ? "#4F46E5"
    : "rgba(0,0,0,0.15)";
  const borderWidth = isSelected || isLockedByOther ? 2 : 1;

  const PADDING = 10;
  const isCircle = object.type === "circle";

  // Auto-fit text size unless user explicitly overrides it.
  const fontSize = useMemo(() => {
    if (typeof object.textSize === "number") {
      return resolveObjectTextSize(object);
    }

    if (!object.text) return 14;
    if (isCircle) {
      const r = Math.min(object.width, object.height) / 2;
      const side = r * Math.sqrt(2);
      return calculateFontSize(object.text, side, side, 8, 9, 28);
    }
    return calculateFontSize(object.text, object.width, object.height, PADDING, 9, 28);
  }, [
    object.type,
    object.text,
    object.width,
    object.height,
    object.textSize,
    isCircle,
  ]);

  const textColor = useMemo(() => {
    if (object.textColor) return object.textColor;
    return getAutoContrastingTextColor(object.color);
  }, [object.color, object.textColor]);

  const renderShape = () => {
    switch (object.type) {
      case "rectangle":
        return (
          <>
            <Rect
              width={object.width}
              height={object.height}
              fill={object.color}
              stroke={borderColor}
              strokeWidth={borderWidth}
              cornerRadius={0}
              shadowColor="#111111"
              shadowBlur={0}
              shadowOffsetX={isSelected && !isEditing ? 4 : 0}
              shadowOffsetY={isSelected && !isEditing ? 4 : 0}
            />
            {!isEditing && (object.text || draftText) && (
              <Text
                x={PADDING}
                y={PADDING}
                width={object.width - PADDING * 2}
                height={object.height - PADDING * 2}
                text={draftText ?? object.text ?? ""}
                fontSize={fontSize}
                fontFamily="Lora, Georgia, serif"
                fill={draftText ? (lockedByColor || "#6366F1") : textColor}
                fontStyle={draftText ? "italic" : "normal"}
                opacity={draftText ? 0.7 : 1}
                wrap="word"
                ellipsis
                verticalAlign={object.textVerticalAlign ?? "middle"}
                align="center"
              />
            )}
          </>
        );
      case "circle": {
        const radius = Math.min(object.width, object.height) / 2;
        const inscribedSide = radius * Math.sqrt(2);
        return (
          <>
            <Circle
              x={object.width / 2}
              y={object.height / 2}
              radius={radius}
              fill={object.color}
              stroke={borderColor || object.color}
              strokeWidth={borderWidth || 1}
              shadowColor="#111111"
              shadowBlur={0}
              shadowOffsetX={isSelected && !isEditing ? 4 : 0}
              shadowOffsetY={isSelected && !isEditing ? 4 : 0}
            />
            {!isEditing && (object.text || draftText) && (
              <Text
                x={(object.width - inscribedSide) / 2}
                y={(object.height - inscribedSide) / 2}
                width={inscribedSide}
                height={inscribedSide}
                text={draftText ?? object.text ?? ""}
                fontSize={fontSize}
                fontFamily="Lora, Georgia, serif"
                fill={draftText ? (lockedByColor || "#6366F1") : textColor}
                fontStyle={draftText ? "italic" : "normal"}
                opacity={draftText ? 0.7 : 1}
                wrap="word"
                ellipsis
                verticalAlign={object.textVerticalAlign ?? "middle"}
                align="center"
              />
            )}
          </>
        );
      }
      case "line":
        return (
          <Line
            points={object.points ?? [0, 0, object.width, object.height]}
            stroke={object.color}
            strokeWidth={object.strokeWidth ?? 3}
            hitStrokeWidth={15}
            lineCap="round"
            lineJoin="round"
          />
        );
      default:
        return (
          <Rect
            width={object.width}
            height={object.height}
            fill={object.color}
            stroke={borderColor}
            strokeWidth={borderWidth}
          />
        );
    }
  };

  return (
    <Group
      id={`node-${object.id}`}
      ref={groupRef}
      x={object.x + object.width / 2}
      y={object.y + object.height / 2}
      offsetX={object.width / 2}
      offsetY={object.height / 2}
      rotation={object.rotation || 0}
      listening={interactable || isArrowHover}
      opacity={isArrowHover ? 0.55 : 1}
      draggable={interactable && !isEditing}
      onClick={() => onSelect(object.id)}
      onTap={() => onSelect(object.id)}
      onDblClick={() => onDoubleClick(object.id)}
      onDblTap={() => onDoubleClick(object.id)}
      onDragStart={() => onDragStart(object.id)}
      onDragMove={(e) => {
        onDragMove(object.id, e.target.x() - object.width / 2, e.target.y() - object.height / 2);
      }}
      onDragEnd={(e) => {
        onDragEnd(object.id, e.target.x() - object.width / 2, e.target.y() - object.height / 2);
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
      {renderShape()}
      {/* Resize handles + rotation */}
      {isSelected && !isEditing && object.type !== "line" && (
        <>
          <ResizeHandles
            object={object}
            circleMode={isCircle}
            onResizeStart={() => {
              originalRef.current = { x: object.x, y: object.y, width: object.width, height: object.height };
            }}
            onResizeMove={(handle: ResizeHandle, px: number, py: number) => {
              if (!originalRef.current) return;
              const result = computeResize(
                originalRef.current,
                handle,
                px,
                py,
                40,
                40,
                isCircle // keepAspect for circles
              );
              onUpdateObject(object.id, result);
            }}
            onResizeEnd={() => {
              originalRef.current = null;
            }}
          />
          <RotationHandle
            objectWidth={object.width}
            objectHeight={object.height}
            rotation={object.rotation || 0}
            onRotateStart={() => onRotateStart?.(object.id)}
            onRotateMove={(angle, shift) => {
              const snapped = shift ? Math.round(angle / 15) * 15 : angle;
              onRotateMove?.(object.id, snapped);
            }}
            onRotateEnd={() => onRotateEnd?.(object.id, object.rotation || 0)}
          />
        </>
      )}
    </Group>
  );
});
