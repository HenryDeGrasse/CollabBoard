import { Group, Line, Circle } from "react-konva";
import type { BoardObject } from "../../types/board";

interface LineObjectProps {
  object: BoardObject;
  isSelected: boolean;
  onSelect: (id: string, multi?: boolean) => void;
  onDragStart: (id: string) => void;
  onDragMove: (id: string, x: number, y: number) => void;
  onDragEnd: (id: string, x: number, y: number) => void;
}

export function LineObject({
  object,
  isSelected,
  onSelect,
  onDragStart,
  onDragMove,
  onDragEnd,
}: LineObjectProps) {
  const points = object.points || [0, 0, object.width, object.height];
  const strokeWidth = object.strokeWidth || 3;

  return (
    <Group
      x={object.x}
      y={object.y}
      draggable
      onClick={(e) => {
        e.cancelBubble = true;
        onSelect(object.id, e.evt.shiftKey);
      }}
      onTap={(e) => {
        e.cancelBubble = true;
        onSelect(object.id);
      }}
      onDragStart={() => onDragStart(object.id)}
      onDragMove={(e) => onDragMove(object.id, e.target.x(), e.target.y())}
      onDragEnd={(e) => onDragEnd(object.id, e.target.x(), e.target.y())}
    >
      <Line
        points={points}
        stroke={isSelected ? "#4F46E5" : object.color}
        strokeWidth={isSelected ? strokeWidth + 1 : strokeWidth}
        hitStrokeWidth={Math.max(20, strokeWidth + 16)}
        lineCap="round"
        lineJoin="round"
      />
      {/* Endpoint indicators when selected */}
      {isSelected && points.length >= 4 && (
        <>
          <Circle
            x={points[0]}
            y={points[1]}
            radius={5}
            fill="#FFFFFF"
            stroke="#4F46E5"
            strokeWidth={2}
            listening={false}
          />
          <Circle
            x={points[points.length - 2]}
            y={points[points.length - 1]}
            radius={5}
            fill="#FFFFFF"
            stroke="#4F46E5"
            strokeWidth={2}
            listening={false}
          />
        </>
      )}
    </Group>
  );
}
