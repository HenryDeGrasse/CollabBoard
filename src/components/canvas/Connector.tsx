import { Arrow, Line } from "react-konva";
import type { Connector as ConnectorType } from "../../types/board";
import type { BoardObject } from "../../types/board";

interface ConnectorProps {
  connector: ConnectorType;
  objects: Record<string, BoardObject>;
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
    // Hits left or right edge
    scale = hw / absDx;
  } else {
    // Hits top or bottom edge
    scale = hh / absDy;
  }

  return {
    x: cx + dx * scale,
    y: cy + dy * scale,
  };
}

export function ConnectorLine({ connector, objects }: ConnectorProps) {
  const fromObj = objects[connector.fromId];
  const toObj = objects[connector.toId];

  if (!fromObj || !toObj) return null;

  const fromCenter = {
    x: fromObj.x + fromObj.width / 2,
    y: fromObj.y + fromObj.height / 2,
  };
  const toCenter = {
    x: toObj.x + toObj.width / 2,
    y: toObj.y + toObj.height / 2,
  };

  // Calculate edge points so arrow starts/ends at object boundaries
  const fromEdge = getEdgePoint(fromObj, toCenter.x, toCenter.y);
  const toEdge = getEdgePoint(toObj, fromCenter.x, fromCenter.y);

  const points = [fromEdge.x, fromEdge.y, toEdge.x, toEdge.y];

  if (connector.style === "arrow") {
    return (
      <Arrow
        points={points}
        stroke="#4B5563"
        strokeWidth={2.5}
        fill="#4B5563"
        pointerLength={14}
        pointerWidth={10}
        hitStrokeWidth={20}
        lineCap="round"
        lineJoin="round"
      />
    );
  }

  return (
    <Line
      points={points}
      stroke="#4B5563"
      strokeWidth={2.5}
      hitStrokeWidth={20}
      lineCap="round"
    />
  );
}
