import React from "react";
import { Group, Arrow, Line, Rect } from "react-konva";
import type { Connector as ConnectorType } from "../../types/board";
import type { BoardObject } from "../../types/board";

interface ConnectorProps {
  connector: ConnectorType;
  /** Source object — undefined when the connector uses a free fromPoint */
  fromObj: BoardObject | undefined;
  /** Target object — undefined when the connector uses a free toPoint */
  toObj: BoardObject | undefined;
  isSelected: boolean;
  onSelect: (id: string) => void;
}

// Rotate point (px, py) around (cx, cy) by `angle` radians
function rotatePoint(px: number, py: number, cx: number, cy: number, angle: number) {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const dx = px - cx;
  const dy = py - cy;
  return {
    x: cx + dx * cos - dy * sin,
    y: cy + dx * sin + dy * cos,
  };
}

// Calculate the intersection point of a line from center to target with the object's edge,
// accounting for rotation.
function getEdgePoint(
  obj: BoardObject,
  targetX: number,
  targetY: number
): { x: number; y: number } {
  const cx = obj.x + obj.width / 2;
  const cy = obj.y + obj.height / 2;
  const rotation = (obj.rotation ?? 0) * (Math.PI / 180); // deg → rad

  // Rotate target into local (un-rotated) coordinate system
  const local = rotation !== 0
    ? rotatePoint(targetX, targetY, cx, cy, -rotation)
    : { x: targetX, y: targetY };

  const dx = local.x - cx;
  const dy = local.y - cy;

  if (dx === 0 && dy === 0) return { x: cx, y: cy };

  let edgeLocal: { x: number; y: number };

  if (obj.type === "circle") {
    const r = Math.min(obj.width, obj.height) / 2;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist === 0) return { x: cx, y: cy };
    edgeLocal = {
      x: cx + (dx / dist) * r,
      y: cy + (dy / dist) * r,
    };
  } else {
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

    edgeLocal = {
      x: cx + dx * scale,
      y: cy + dy * scale,
    };
  }

  // Rotate edge point back to world space
  if (rotation !== 0) {
    return rotatePoint(edgeLocal.x, edgeLocal.y, cx, cy, rotation);
  }
  return edgeLocal;
}

export const ConnectorLine = React.memo(function ConnectorLine({ connector, fromObj, toObj, isSelected, onSelect }: ConnectorProps) {
  // Resolve start point: pinned to object edge, or free-floating anchor
  const fromEdge: { x: number; y: number } = (() => {
    if (fromObj) {
      // Pinned — find edge point facing the target
      const targetX = toObj
        ? toObj.x + toObj.width / 2
        : (connector.toPoint?.x ?? fromObj.x + fromObj.width / 2);
      const targetY = toObj
        ? toObj.y + toObj.height / 2
        : (connector.toPoint?.y ?? fromObj.y + fromObj.height / 2);
      return getEdgePoint(fromObj, targetX, targetY);
    }
    // Free-floating start
    return connector.fromPoint ?? { x: 0, y: 0 };
  })();

  // Resolve end point: pinned to object edge, or free-floating anchor
  const toEdge: { x: number; y: number } = (() => {
    if (toObj) {
      // Pinned — find edge point facing the source
      const sourceX = fromObj
        ? fromObj.x + fromObj.width / 2
        : (connector.fromPoint?.x ?? toObj.x + toObj.width / 2);
      const sourceY = fromObj
        ? fromObj.y + fromObj.height / 2
        : (connector.fromPoint?.y ?? toObj.y + toObj.height / 2);
      return getEdgePoint(toObj, sourceX, sourceY);
    }
    // Free-floating end
    return connector.toPoint ?? { x: 0, y: 0 };
  })();

  const points = [fromEdge.x, fromEdge.y, toEdge.x, toEdge.y];

  // Midpoint for selection indicator
  const midX = (fromEdge.x + toEdge.x) / 2;
  const midY = (fromEdge.y + toEdge.y) / 2;

  const handleClick = (e: any) => {
    e.cancelBubble = true; // Stop propagation to stage
    onSelect(connector.id);
  };

  const baseColor = connector.color || "#4B5563";
  const baseWidth = connector.strokeWidth ?? 2.5;
  const strokeColor = isSelected ? "#0F2044" : baseColor;
  const strokeWidth = isSelected ? baseWidth + 0.5 : baseWidth;

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
        {/* Midpoint indicator — always visible on hover, solid when selected */}
        <Rect
          x={midX - 5}
          y={midY - 5}
          width={10}
          height={10}
          fill={isSelected ? "#0F2044" : "transparent"}
          stroke={isSelected ? "#0F2044" : "transparent"}
          strokeWidth={1}
          cornerRadius={2}
          hitStrokeWidth={16}
          onMouseEnter={(e) => {
            const c = e.target.getStage()?.container();
            if (c) c.style.cursor = "pointer";
            if (!isSelected) {
              (e.target as any).fill("rgba(15, 32, 68, 0.3)");
              (e.target as any).stroke("rgba(15, 32, 68, 0.5)");
            }
          }}
          onMouseLeave={(e) => {
            const c = e.target.getStage()?.container();
            if (c) c.style.cursor = "default";
            if (!isSelected) {
              (e.target as any).fill("transparent");
              (e.target as any).stroke("transparent");
            }
          }}
          onClick={handleClick}
          onTap={handleClick}
        />
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
      <Rect
        x={midX - 5}
        y={midY - 5}
        width={10}
        height={10}
        fill={isSelected ? "#0F2044" : "transparent"}
        stroke={isSelected ? "#0F2044" : "transparent"}
        strokeWidth={1}
        cornerRadius={2}
        hitStrokeWidth={16}
        onMouseEnter={(e) => {
          const c = e.target.getStage()?.container();
          if (c) c.style.cursor = "pointer";
          if (!isSelected) {
            (e.target as any).fill("rgba(15, 32, 68, 0.3)");
            (e.target as any).stroke("rgba(15, 32, 68, 0.5)");
          }
        }}
        onMouseLeave={(e) => {
          const c = e.target.getStage()?.container();
          if (c) c.style.cursor = "default";
          if (!isSelected) {
            (e.target as any).fill("transparent");
            (e.target as any).stroke("transparent");
          }
        }}
        onClick={handleClick}
        onTap={handleClick}
      />
    </Group>
  );
});
