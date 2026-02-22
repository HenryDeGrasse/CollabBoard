import React from "react";
import { ConnectorLine } from "./Connector";
import type { BoardObject, Connector } from "../../types/board";

interface TopLevelConnectorsProps {
  connectors: Record<string, Connector>;
  objects: Record<string, BoardObject>;
  objectsWithLivePositions: Record<string, BoardObject>;
  poppedOutDraggedObjectIds: Set<string>;
  selectedConnectorIds: Set<string>;
  onConnectorSelect: (id: string) => void;
  visibleBounds: { left: number; top: number; right: number; bottom: number };
}

function isConnectorInViewport(
  conn: Connector,
  objectsWithLive: Record<string, BoardObject>,
  bounds: { left: number; top: number; right: number; bottom: number },
): boolean {
  const from = conn.fromId ? objectsWithLive[conn.fromId] : undefined;
  const to = conn.toId ? objectsWithLive[conn.toId] : undefined;
  const fromPt = from
    ? { x: from.x, y: from.y, w: from.width, h: from.height }
    : conn.fromPoint
      ? { x: conn.fromPoint.x, y: conn.fromPoint.y, w: 0, h: 0 }
      : null;
  const toPt = to
    ? { x: to.x, y: to.y, w: to.width, h: to.height }
    : conn.toPoint
      ? { x: conn.toPoint.x, y: conn.toPoint.y, w: 0, h: 0 }
      : null;

  // If we can't determine bounds, render to be safe
  if (!fromPt || !toPt) return true;

  const minX = Math.min(fromPt.x, toPt.x);
  const maxX = Math.max(fromPt.x + fromPt.w, toPt.x + toPt.w);
  const minY = Math.min(fromPt.y, toPt.y);
  const maxY = Math.max(fromPt.y + fromPt.h, toPt.y + toPt.h);

  return (
    maxX >= bounds.left &&
    minX <= bounds.right &&
    maxY >= bounds.top &&
    minY <= bounds.bottom
  );
}

export const TopLevelConnectors = React.memo(function TopLevelConnectors({
  connectors,
  objects,
  objectsWithLivePositions,
  poppedOutDraggedObjectIds,
  selectedConnectorIds,
  onConnectorSelect,
  visibleBounds,
}: TopLevelConnectorsProps) {
  return (
    <>
      {Object.values(connectors)
        .filter((conn) => {
          const from = conn.fromId ? objects[conn.fromId] : undefined;
          const to = conn.toId ? objects[conn.toId] : undefined;
          const fromFrame = from?.parentFrameId ?? null;
          const toFrame = to?.parentFrameId ?? null;
          if (
            (conn.fromId && poppedOutDraggedObjectIds.has(conn.fromId)) ||
            (conn.toId && poppedOutDraggedObjectIds.has(conn.toId))
          ) return true;
          if (!conn.fromId || !conn.toId) return true;
          return !(fromFrame !== null && fromFrame === toFrame);
        })
        .filter((conn) =>
          isConnectorInViewport(conn, objectsWithLivePositions, visibleBounds)
        )
        .map((conn) => {
          const fromObj = conn.fromId ? objectsWithLivePositions[conn.fromId] : undefined;
          const toObj = conn.toId ? objectsWithLivePositions[conn.toId] : undefined;
          if (conn.fromId && !fromObj && !conn.fromPoint) return null;
          if (conn.toId && !toObj && !conn.toPoint) return null;
          return (
            <ConnectorLine
              key={`top-${conn.id}`}
              connector={conn}
              fromObj={fromObj}
              toObj={toObj}
              isSelected={selectedConnectorIds.has(conn.id)}
              onSelect={onConnectorSelect}
            />
          );
        })}
    </>
  );
});
