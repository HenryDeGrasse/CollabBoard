import React from "react";
import { Layer } from "react-konva";
import { RemoteCursor } from "./RemoteCursor";
import { useCursorInterpolation } from "../../hooks/presence/useCursorInterpolation";
import type { CursorStore } from "../../hooks/presence/usePresence";

interface RemoteCursorsLayerProps {
  cursorStore: CursorStore;
  users: Record<string, { id: string; displayName: string; cursorColor: string; online: boolean }>;
  currentUserId: string;
}

/**
 * Isolated component for rendering remote cursors.
 *
 * This component owns the cursor interpolation rAF loop. The forceUpdate()
 * inside useCursorInterpolation only re-renders THIS component (~5 Konva
 * shapes per cursor) instead of the entire Board tree (hundreds of shapes).
 *
 * It subscribes to the ref-based CursorStore from usePresence, so cursor
 * position broadcasts never touch React state that Board depends on.
 */
export const RemoteCursorsLayer = React.memo(function RemoteCursorsLayer({
  cursorStore,
  users,
  currentUserId,
}: RemoteCursorsLayerProps) {
  const remoteCursors = useCursorInterpolation(cursorStore, users, currentUserId);

  return (
    <Layer listening={false}>
      {remoteCursors.map((cursor) => (
        <RemoteCursor
          key={cursor.id}
          displayName={cursor.displayName}
          color={cursor.color}
          x={cursor.x}
          y={cursor.y}
        />
      ))}
    </Layer>
  );
});
