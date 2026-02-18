import React from "react";
import { Group, Arrow, Line, Rect } from "react-konva";
import type { Connector as ConnectorType } from "../../types/board";
import type { BoardObject } from "../../types/board";

interface ConnectorProps {
  connector: ConnectorType;
  fromObj: BoardObject;
  toObj: BoardObject;
  isSelected: boolean;
  onSelect: (id: string) => void;
}

// Calculate the intersection point of a line from center to target with the object's edge
function getEdgePoint(
  obj: BoardObject,
  targetX: number,
  targetY: number
): { x: number; y: number } {
  const cx = obj.x + obj.width / 2;
  const cy = obj.y + obj.height / 2;
  const dx = targetX - cx;
  const dy = targetY - cy;

  if (dx === 0 && dy === 0) return { x: cx, y: cy };

  if (obj.type === "circle") {
    const r = Math.min(obj.width, obj.height) / 2;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist === 0) return { x: cx, y: cy };
    return {
      x: cx + (dx / dist) * r,
      y: cy + (dy / dist) * r,
    };
  }

  // Rectangle edge intersection
  const hw = obj.width / 2;
  const hh = obj.height / 2;
  const absDx = Math.abs(dx);
  const absDy = Math.abs(dy);

  let scale: number;
  if (absDx * hh > absDy * hw) {
    scale = hw / absDx;
  } else {
    scale = hh / absDy;
  }

  return {
    x: cx + dx * scale,
    y: cy + dy * scale,
  };
}

export const ConnectorLine = React.memo(function ConnectorLine({ connector, fromObj, toObj, isSelected, onSelect }: ConnectorProps) {
  const fromCenter = {
    x: fromObj.x + fromObj.width / 2,
    y: fromObj.y + fromObj.height / 2,
  };
  const toCenter = {
    x: toObj.x + toObj.width / 2,
    y: toObj.y + toObj.height / 2,
  };

  const fromEdge = getEdgePoint(fromObj, toCenter.x, toCenter.y);
  const toEdge = getEdgePoint(toObj, fromCenter.x, fromCenter.y);

  const points = [fromEdge.x, fromEdge.y, toEdge.x, toEdge.y];

  // Midpoint for selection indicator
  const midX = (fromEdge.x + toEdge.x) / 2;
  const midY = (fromEdge.y + toEdge.y) / 2;

  const handleClick = (e: any) => {
    e.cancelBubble = true; // Stop propagation to stage
    onSelect(connector.id);
  };

  const strokeColor = isSelected ? "#4F46E5" : "#4B5563";
  const strokeWidth = isSelected ? 3 : 2.5;

  if (connector.style === "arrow") {
    return (
      <Group>
        <Arrow
          points={points}
          stroke={strokeColor}
          strokeWidth={strokeWidth}
          fill={strokeColor}
          pointerLength={14}
          pointerWidth={10}
          hitStrokeWidth={24}
          lineCap="round"
          lineJoin="round"
          onClick={handleClick}
          onTap={handleClick}
        />
        {/* Selection midpoint indicator */}
        {isSelected && (
          <Rect
            x={midX - 5}
            y={midY - 5}
            width={10}
            height={10}
            fill="#4F46E5"
            cornerRadius={2}
            listening={false}
          />
        )}
      </Group>
    );
  }

  return (
    <Group>
      <Line
        points={points}
        stroke={strokeColor}
        strokeWidth={strokeWidth}
        hitStrokeWidth={24}
        lineCap="round"
        onClick={handleClick}
        onTap={handleClick}
      />
      {isSelected && (
        <Rect
          x={midX - 5}
          y={midY - 5}
          width={10}
          height={10}
          fill="#4F46E5"
          cornerRadius={2}
          listening={false}
        />
      )}
    </Group>
  );
});
