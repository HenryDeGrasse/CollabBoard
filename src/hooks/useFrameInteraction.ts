import { useState, useCallback, useRef, useEffect } from "react";
import Konva from "konva";
import type { BoardObject } from "../types/board";
import type { ViewportState } from "./useCanvas";
import type { UndoAction } from "./useUndoRedo";

export interface FrameManualDragState {
  frameId: string;
  startMouseX: number;
  startMouseY: number;
  startFrameX: number;
  startFrameY: number;
}

export interface UseFrameInteractionReturn {
  frameManualDrag: FrameManualDragState | null;
  frameResizeTrackRef: React.MutableRefObject<{
    frameId: string;
    startFrame: { x: number; y: number; width: number; height: number };
    startChildren: Record<string, { x: number; y: number }>;
    movedChildIds: Set<string>;
  } | null>;
  handleFrameResizeStart: (frameId: string) => void;
  handleFrameHeaderDragStart: (frameId: string) => void;
  /** Handle frame manual drag movement on mouse move */
  onMouseMove: (canvasPoint: { x: number; y: number }) => void;
  /** Commit frame manual drag on mouse up. Returns true if handled. */
  onMouseUp: () => boolean;
}

export function useFrameInteraction(
  viewport: ViewportState,
  stageRef: React.RefObject<Konva.Stage | null>,
  objectsRef: React.MutableRefObject<Record<string, BoardObject>>,
  dragPositions: Record<string, { x: number; y: number }>,
  frameContainedRef: React.MutableRefObject<Record<string, { dx: number; dy: number }>>,
  dragStartPosRef: React.MutableRefObject<Record<string, { x: number; y: number }>>,
  lastBroadcastRef: React.MutableRefObject<number>,
  lastDragBroadcastRef: React.MutableRefObject<Record<string, { x: number; y: number; parentFrameId: string | null }>>,
  BROADCAST_INTERVAL: number,
  dragInsideFrameRef: React.MutableRefObject<Set<string>>,
  scheduleDragStateUpdate: (
    positions: Record<string, { x: number; y: number }>,
    parentMap: Record<string, string | null>
  ) => void,
  clearDragPositionsSoon: () => void,
  onUpdateObject: (id: string, updates: Partial<BoardObject>) => void,
  onObjectDragBroadcast: (
    objectId: string,
    x: number,
    y: number,
    parentFrameId?: string | null,
    width?: number,
    height?: number
  ) => void,
  onObjectDragEndBroadcast: (objectId: string) => void,
  onPushUndo: (action: UndoAction) => void,
  getObjectsInFrame: (frameId: string) => BoardObject[],
  frameManualDragActiveRef: React.MutableRefObject<boolean>
): UseFrameInteractionReturn {
  const [frameManualDrag, setFrameManualDrag] = useState<FrameManualDragState | null>(null);

  // Sync the shared ref so useDragSystem heartbeat can check it
  useEffect(() => { frameManualDragActiveRef.current = frameManualDrag !== null; }, [frameManualDrag, frameManualDragActiveRef]);

  const frameResizeTrackRef = useRef<{
    frameId: string;
    startFrame: { x: number; y: number; width: number; height: number };
    startChildren: Record<string, { x: number; y: number }>;
    movedChildIds: Set<string>;
  } | null>(null);

  const handleFrameResizeStart = useCallback((frameId: string) => {
    const children = Object.values(objectsRef.current).filter(
      (o) => o.parentFrameId === frameId && o.type !== "frame"
    );
    const frame = objectsRef.current[frameId];
    if (!frame) return;
    const startChildren: Record<string, { x: number; y: number }> = {};
    for (const c of children) {
      startChildren[c.id] = { x: c.x, y: c.y };
    }
    frameResizeTrackRef.current = {
      frameId,
      startFrame: { x: frame.x, y: frame.y, width: frame.width, height: frame.height },
      startChildren,
      movedChildIds: new Set(),
    };
  }, [objectsRef]);

  const handleFrameHeaderDragStart = useCallback((frameId: string) => {
    const frame = objectsRef.current[frameId];
    if (!frame) return;

    const stage = stageRef.current;
    if (!stage) return;

    const pointerPos = stage.getPointerPosition();
    if (!pointerPos) return;

    const canvasX = (pointerPos.x - viewport.x) / viewport.scale;
    const canvasY = (pointerPos.y - viewport.y) / viewport.scale;

    setFrameManualDrag({
      frameId,
      startMouseX: canvasX,
      startMouseY: canvasY,
      startFrameX: frame.x,
      startFrameY: frame.y,
    });

    dragStartPosRef.current[frameId] = { x: frame.x, y: frame.y };

    const frameOffsets: Record<string, { dx: number; dy: number }> = {};
    getObjectsInFrame(frameId).forEach((cobj) => {
      frameOffsets[cobj.id] = { dx: cobj.x - frame.x, dy: cobj.y - frame.y };
      dragStartPosRef.current[cobj.id] = { x: cobj.x, y: cobj.y };
    });
    frameContainedRef.current = frameOffsets;
  }, [viewport, stageRef, objectsRef, getObjectsInFrame, dragStartPosRef, frameContainedRef]);

  const onMouseMove = useCallback(
    (canvasPoint: { x: number; y: number }) => {
      if (!frameManualDrag) return;

      const { frameId, startMouseX, startMouseY, startFrameX, startFrameY } = frameManualDrag;
      const dx = canvasPoint.x - startMouseX;
      const dy = canvasPoint.y - startMouseY;
      const newX = startFrameX + dx;
      const newY = startFrameY + dy;

      const newPositions: Record<string, { x: number; y: number }> = {
        [frameId]: { x: newX, y: newY },
      };

      const frameOffsets = frameContainedRef.current;
      for (const [cid, offset] of Object.entries(frameOffsets)) {
        newPositions[cid] = { x: newX + offset.dx, y: newY + offset.dy };
      }

      const frameParentMap: Record<string, string | null> = { [frameId]: null };
      for (const cid of Object.keys(newPositions)) {
        if (cid !== frameId) frameParentMap[cid] = frameId;
      }
      scheduleDragStateUpdate(newPositions, frameParentMap);

      const frameNow = performance.now();
      if (frameNow - lastBroadcastRef.current >= BROADCAST_INTERVAL) {
        lastBroadcastRef.current = frameNow;
        onObjectDragBroadcast(frameId, newX, newY, null);
        lastDragBroadcastRef.current[frameId] = { x: newX, y: newY, parentFrameId: null };
        for (const [cid, pos] of Object.entries(newPositions)) {
          if (cid === frameId) continue;
          onObjectDragBroadcast(cid, pos.x, pos.y, frameId);
          lastDragBroadcastRef.current[cid] = { x: pos.x, y: pos.y, parentFrameId: frameId };
        }
      }
    },
    [
      frameManualDrag,
      frameContainedRef,
      scheduleDragStateUpdate,
      lastBroadcastRef,
      lastDragBroadcastRef,
      BROADCAST_INTERVAL,
      onObjectDragBroadcast,
    ]
  );

  const onMouseUp = useCallback((): boolean => {
    if (!frameManualDrag) return false;

    const { frameId } = frameManualDrag;
    const draggedPos = dragPositions[frameId];
    if (draggedPos) {
      onUpdateObject(frameId, { x: draggedPos.x, y: draggedPos.y });

      const frameOffsets = frameContainedRef.current;
      for (const cid of Object.keys(frameOffsets)) {
        const cpos = dragPositions[cid];
        if (cpos) {
          onUpdateObject(cid, { x: cpos.x, y: cpos.y });
          onObjectDragBroadcast(cid, cpos.x, cpos.y, frameId);
          onObjectDragEndBroadcast(cid);
        }
      }

      onObjectDragBroadcast(frameId, draggedPos.x, draggedPos.y, null);
      onObjectDragEndBroadcast(frameId);

      const startPos = dragStartPosRef.current[frameId];
      if (startPos) {
        onPushUndo({
          type: "update_object",
          objectId: frameId,
          before: { x: startPos.x, y: startPos.y },
          after: { x: draggedPos.x, y: draggedPos.y },
        });
      }
    }

    lastDragBroadcastRef.current = {};
    setFrameManualDrag(null);
    clearDragPositionsSoon();
    frameContainedRef.current = {};
    dragStartPosRef.current = {};
    dragInsideFrameRef.current.clear();

    return true;
  }, [
    frameManualDrag,
    dragPositions,
    frameContainedRef,
    dragStartPosRef,
    lastDragBroadcastRef,
    dragInsideFrameRef,
    onUpdateObject,
    onObjectDragBroadcast,
    onObjectDragEndBroadcast,
    onPushUndo,
    clearDragPositionsSoon,
  ]);

  return {
    frameManualDrag,
    frameResizeTrackRef,
    handleFrameResizeStart,
    handleFrameHeaderDragStart,
    onMouseMove,
    onMouseUp,
  };
}
