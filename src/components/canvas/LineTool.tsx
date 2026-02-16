import { useRef } from "react";
import { Group, Line, Circle } from "react-konva";
import Konva from "konva";
import type { BoardObject } from "../../types/board";

interface LineObjectProps {
  object: BoardObject;
  isSelected: boolean;
  onSelect: (id: string, multi?: boolean) => void;
  onDragStart: (id: string) => void;
  onDragMove: (id: string, x: number, y: number) => void;
  onDragEnd: (id: string, x: number, y: number) => void;
  onUpdateObject: (id: string, updates: Partial<BoardObject>) => void;
}

export function LineObject({
  object,
  isSelected,
  onSelect,
  onDragStart,
  onDragMove,
  onDragEnd,
  onUpdateObject,
}: LineObjectProps) {
  const points = object.points || [0, 0, object.width, object.height];
  const strokeWidth = object.strokeWidth || 3;
  const endpointDraggingRef = useRef(false);

  const handleEndpointDragStart = (e: Konva.KonvaEventObject<DragEvent>) => {
    e.cancelBubble = true;
    endpointDraggingRef.current = true;
  };

  const handleStartPointDragEnd = (e: Konva.KonvaEventObject<DragEvent>) => {
    e.cancelBubble = true;
    endpointDraggingRef.current = false;

    // New start point position (relative to group)
    const newX1 = e.target.x();
    const newY1 = e.target.y();
    // End point stays where it was
    const x2 = points[points.length - 2];
    const y2 = points[points.length - 1];

    // Recalculate the object origin and relative points
    const minX = Math.min(newX1, x2);
    const minY = Math.min(newY1, y2);
    const newPoints = [newX1 - minX, newY1 - minY, x2 - minX, y2 - minY];

    onUpdateObject(object.id, {
      x: object.x + minX,
      y: object.y + minY,
      width: Math.abs(x2 - newX1) || 1,
      height: Math.abs(y2 - newY1) || 1,
      points: newPoints,
    });

    // Reset the circle position (Konva moved it)
    e.target.x(newPoints[0]);
    e.target.y(newPoints[1]);
  };

  const handleEndPointDragEnd = (e: Konva.KonvaEventObject<DragEvent>) => {
    e.cancelBubble = true;
    endpointDraggingRef.current = false;

    const x1 = points[0];
    const y1 = points[1];
    const newX2 = e.target.x();
    const newY2 = e.target.y();

    const minX = Math.min(x1, newX2);
    const minY = Math.min(y1, newY2);
    const newPoints = [x1 - minX, y1 - minY, newX2 - minX, newY2 - minY];

    onUpdateObject(object.id, {
      x: object.x + minX,
      y: object.y + minY,
      width: Math.abs(newX2 - x1) || 1,
      height: Math.abs(newY2 - y1) || 1,
      points: newPoints,
    });

    e.target.x(newPoints[2]);
    e.target.y(newPoints[3]);
  };

  return (
    <Group
      x={object.x}
      y={object.y}
      draggable={!endpointDraggingRef.current}
      onClick={(e) => {
        e.cancelBubble = true;
        onSelect(object.id, e.evt.shiftKey);
      }}
      onTap={(e) => {
        e.cancelBubble = true;
        onSelect(object.id);
      }}
      onDragStart={() => {
        if (!endpointDraggingRef.current) onDragStart(object.id);
      }}
      onDragMove={(e) => {
        if (!endpointDraggingRef.current) onDragMove(object.id, e.target.x(), e.target.y());
      }}
      onDragEnd={(e) => {
        if (!endpointDraggingRef.current) onDragEnd(object.id, e.target.x(), e.target.y());
      }}
    >
      {/* The line itself */}
      <Line
        points={points}
        stroke={isSelected ? "#4F46E5" : object.color}
        strokeWidth={isSelected ? strokeWidth + 1 : strokeWidth}
        hitStrokeWidth={Math.max(20, strokeWidth + 16)}
        lineCap="round"
        lineJoin="round"
      />

      {/* Draggable endpoint handles when selected */}
      {isSelected && points.length >= 4 && (
        <>
          {/* Start point */}
          <Circle
            x={points[0]}
            y={points[1]}
            radius={6}
            fill="#FFFFFF"
            stroke="#4F46E5"
            strokeWidth={2}
            draggable
            hitStrokeWidth={12}
            onDragStart={handleEndpointDragStart}
            onDragEnd={handleStartPointDragEnd}
            onMouseEnter={(e) => {
              const container = e.target.getStage()?.container();
              if (container) container.style.cursor = "grab";
            }}
            onMouseLeave={(e) => {
              const container = e.target.getStage()?.container();
              if (container) container.style.cursor = "default";
            }}
          />
          {/* End point */}
          <Circle
            x={points[points.length - 2]}
            y={points[points.length - 1]}
            radius={6}
            fill="#FFFFFF"
            stroke="#4F46E5"
            strokeWidth={2}
            draggable
            hitStrokeWidth={12}
            onDragStart={handleEndpointDragStart}
            onDragEnd={handleEndPointDragEnd}
            onMouseEnter={(e) => {
              const container = e.target.getStage()?.container();
              if (container) container.style.cursor = "grab";
            }}
            onMouseLeave={(e) => {
              const container = e.target.getStage()?.container();
              if (container) container.style.cursor = "default";
            }}
          />
        </>
      )}
    </Group>
  );
}
