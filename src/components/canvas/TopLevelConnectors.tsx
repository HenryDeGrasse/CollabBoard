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
}

export function TopLevelConnectors({
  connectors,
  objects,
  objectsWithLivePositions,
  poppedOutDraggedObjectIds,
  selectedConnectorIds,
  onConnectorSelect,
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
          return !(fromFrame != null && fromFrame === toFrame);
        })
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
}
