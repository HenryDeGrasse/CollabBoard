import { useRef, useState } from "react";
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
  const basePoints = object.points || [0, 0, object.width, object.height];
  const strokeWidth = object.strokeWidth || 3;
  const endpointDraggingRef = useRef(false);

  // Local override while dragging an endpoint (for live preview)
  const [livePoints, setLivePoints] = useState<number[] | null>(null);
  const displayPoints = livePoints ?? basePoints;

  const commitEndpoint = (
    anchorIdx: 0 | 1, // 0=start anchored, 1=end anchored
    movedX: number,
    movedY: number,
    target: Konva.Node,
  ) => {
    endpointDraggingRef.current = false;
    setLivePoints(null);

    const anchorX = basePoints[anchorIdx === 0 ? 0 : basePoints.length - 2];
    const anchorY = basePoints[anchorIdx === 0 ? 1 : basePoints.length - 1];

    const x1 = anchorIdx === 0 ? anchorX : movedX;
    const y1 = anchorIdx === 0 ? anchorY : movedY;
    const x2 = anchorIdx === 0 ? movedX : anchorX;
    const y2 = anchorIdx === 0 ? movedY : anchorY;

    const minX = Math.min(x1, x2);
    const minY = Math.min(y1, y2);
    const newPoints = [x1 - minX, y1 - minY, x2 - minX, y2 - minY];

    onUpdateObject(object.id, {
      x: object.x + minX,
      y: object.y + minY,
      width: Math.abs(x2 - x1) || 1,
      height: Math.abs(y2 - y1) || 1,
      points: newPoints,
    });

    // Reset Konva node position
    target.x(anchorIdx === 0 ? newPoints[2] : newPoints[0]);
    target.y(anchorIdx === 0 ? newPoints[3] : newPoints[1]);
  };

  // --- Start point handlers ---
  const handleStartDragMove = (e: Konva.KonvaEventObject<DragEvent>) => {
    e.cancelBubble = true;
    const newX = e.target.x();
    const newY = e.target.y();
    setLivePoints([newX, newY, basePoints[basePoints.length - 2], basePoints[basePoints.length - 1]]);
  };

  const handleStartDragEnd = (e: Konva.KonvaEventObject<DragEvent>) => {
    e.cancelBubble = true;
    commitEndpoint(1, e.target.x(), e.target.y(), e.target); // anchor=end, moved=start
  };

  // --- End point handlers ---
  const handleEndDragMove = (e: Konva.KonvaEventObject<DragEvent>) => {
    e.cancelBubble = true;
    const newX = e.target.x();
    const newY = e.target.y();
    setLivePoints([basePoints[0], basePoints[1], newX, newY]);
  };

  const handleEndDragEnd = (e: Konva.KonvaEventObject<DragEvent>) => {
    e.cancelBubble = true;
    commitEndpoint(0, e.target.x(), e.target.y(), e.target); // anchor=start, moved=end
  };

  const handleEndpointDragStart = (e: Konva.KonvaEventObject<DragEvent>) => {
    e.cancelBubble = true;
    endpointDraggingRef.current = true;
  };

  return (
    <Group
      id={`node-${object.id}`}
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
        points={displayPoints}
        stroke={isSelected ? "#4F46E5" : object.color}
        strokeWidth={isSelected ? strokeWidth + 1 : strokeWidth}
        hitStrokeWidth={Math.max(20, strokeWidth + 16)}
        lineCap="round"
        lineJoin="round"
      />

      {/* Draggable endpoint handles when selected */}
      {isSelected && displayPoints.length >= 4 && (
        <>
          {/* Start point */}
          <Circle
            x={displayPoints[0]}
            y={displayPoints[1]}
            radius={6}
            fill="#FFFFFF"
            stroke="#4F46E5"
            strokeWidth={2}
            draggable
            hitStrokeWidth={12}
            onDragStart={handleEndpointDragStart}
            onDragMove={handleStartDragMove}
            onDragEnd={handleStartDragEnd}
            onMouseEnter={(e) => {
              const c = e.target.getStage()?.container();
              if (c) c.style.cursor = "grab";
            }}
            onMouseLeave={(e) => {
              const c = e.target.getStage()?.container();
              if (c) c.style.cursor = "default";
            }}
          />
          {/* End point */}
          <Circle
            x={displayPoints[displayPoints.length - 2]}
            y={displayPoints[displayPoints.length - 1]}
            radius={6}
            fill="#FFFFFF"
            stroke="#4F46E5"
            strokeWidth={2}
            draggable
            hitStrokeWidth={12}
            onDragStart={handleEndpointDragStart}
            onDragMove={handleEndDragMove}
            onDragEnd={handleEndDragEnd}
            onMouseEnter={(e) => {
              const c = e.target.getStage()?.container();
              if (c) c.style.cursor = "grab";
            }}
            onMouseLeave={(e) => {
              const c = e.target.getStage()?.container();
              if (c) c.style.cursor = "default";
            }}
          />
        </>
      )}
    </Group>
  );
}
