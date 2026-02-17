import { useMemo, useRef } from "react";
import { Group, Rect, Circle, Line, Text } from "react-konva";
import type { BoardObject } from "../../types/board";
import { ResizeHandles, computeResize, type ResizeHandle } from "./ResizeHandles";
import { calculateFontSize } from "../../utils/text-fit";

interface ShapeProps {
  object: BoardObject;
  isSelected: boolean;
  isEditing: boolean;
  isLockedByOther: boolean;
  lockedByColor?: string;
  draftText?: string;
  onSelect: (id: string) => void;
  onDragStart: (id: string) => void;
  onDragMove: (id: string, x: number, y: number) => void;
  onDragEnd: (id: string, x: number, y: number) => void;
  onDoubleClick: (id: string) => void;
  onUpdateObject: (id: string, updates: Partial<BoardObject>) => void;
}

export function Shape({
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
}: ShapeProps) {
  const groupRef = useRef<any>(null);
  const originalRef = useRef<{ x: number; y: number; width: number; height: number } | null>(null);

  const borderColor = isLockedByOther
    ? lockedByColor || "#EF4444"
    : isSelected
    ? "#4F46E5"
    : "rgba(0,0,0,0.15)";
  const borderWidth = isSelected || isLockedByOther ? 2 : 1;

  const PADDING = 10;
  const isCircle = object.type === "circle";

  // Auto-fit font size for text inside shapes
  const fontSize = useMemo(() => {
    if (!object.text) return 14;
    if (isCircle) {
      const r = Math.min(object.width, object.height) / 2;
      const side = r * Math.sqrt(2);
      return calculateFontSize(object.text, side, side, 8, 9, 28);
    }
    return calculateFontSize(object.text, object.width, object.height, PADDING, 9, 28);
  }, [object.text, object.width, object.height, isCircle]);

  // Determine if text should be light or dark based on background
  const textColor = useMemo(() => {
    const hex = object.color.replace("#", "");
    if (hex.length < 6) return "#1F2937";
    const r = parseInt(hex.substring(0, 2), 16);
    const g = parseInt(hex.substring(2, 4), 16);
    const b = parseInt(hex.substring(4, 6), 16);
    const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
    return luminance > 0.5 ? "#1F2937" : "#FFFFFF";
  }, [object.color]);

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
              cornerRadius={4}
            />
            {!isEditing && (object.text || draftText) && (
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
                opacity={draftText ? 0.7 : 1}
                wrap="word"
                ellipsis
                verticalAlign="middle"
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
            />
            {!isEditing && (object.text || draftText) && (
              <Text
                x={(object.width - inscribedSide) / 2}
                y={(object.height - inscribedSide) / 2}
                width={inscribedSide}
                height={inscribedSide}
                text={draftText ?? object.text ?? ""}
                fontSize={fontSize}
                fontFamily="Inter, system-ui, sans-serif"
                fill={draftText ? (lockedByColor || "#6366F1") : textColor}
                fontStyle={draftText ? "italic" : "normal"}
                opacity={draftText ? 0.7 : 1}
                wrap="word"
                ellipsis
                verticalAlign="middle"
                align="center"
              />
            )}
          </>
        );
      }
      case "line":
        return (
          <Line
            points={[0, 0, object.width, object.height]}
            stroke={object.color}
            strokeWidth={3}
            hitStrokeWidth={15}
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
      {renderShape()}
      {/* Resize handles */}
      {isSelected && !isEditing && object.type !== "line" && (
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
      )}
    </Group>
  );
}
