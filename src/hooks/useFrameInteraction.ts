import { useState, useCallback, useRef, useEffect } from "react";
import Konva from "konva";
import type { BoardObject } from "../types/board";
import type { ViewportState } from "./useCanvas";
import type { UndoAction } from "./useUndoRedo";
import { constrainObjectOutsideFrames } from "../utils/frame-containment";

export interface FrameManualDragState {
  frameId: string;
  startMouseX: number;
  startMouseY: number;
  startFrameX: number;
  startFrameY: number;
  /** Offsets for other selected objects being group-dragged along with the primary frame */
  groupOffsets: Record<string, { dx: number; dy: number }>;
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
  frameManualDragActiveRef: React.MutableRefObject<boolean>,
  selectedIdsRef: React.MutableRefObject<Set<string>>,
  getFrameAtPoint: (x: number, y: number) => BoardObject | null
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

    // Collect offsets for other selected objects (group drag support)
    const groupOffsets: Record<string, { dx: number; dy: number }> = {};
    const currentSelectedIds = selectedIdsRef.current;
    if (currentSelectedIds.has(frameId) && currentSelectedIds.size > 1) {
      currentSelectedIds.forEach((sid) => {
        if (sid !== frameId) {
          const sobj = objectsRef.current[sid];
          if (sobj) {
            groupOffsets[sid] = { dx: sobj.x - frame.x, dy: sobj.y - frame.y };
            dragStartPosRef.current[sid] = { x: sobj.x, y: sobj.y };
          }
        }
      });
    }

    setFrameManualDrag({
      frameId,
      startMouseX: canvasX,
      startMouseY: canvasY,
      startFrameX: frame.x,
      startFrameY: frame.y,
      groupOffsets,
    });

    dragStartPosRef.current[frameId] = { x: frame.x, y: frame.y };

    const frameOffsets: Record<string, { dx: number; dy: number }> = {};
    // Collect children of the primary frame
    getObjectsInFrame(frameId).forEach((cobj) => {
      frameOffsets[cobj.id] = { dx: cobj.x - frame.x, dy: cobj.y - frame.y };
      dragStartPosRef.current[cobj.id] = { x: cobj.x, y: cobj.y };
    });
    // Also collect children of other selected frames in the group
    for (const [sid] of Object.entries(groupOffsets)) {
      const sobj = objectsRef.current[sid];
      if (sobj?.type === "frame") {
        getObjectsInFrame(sid).forEach((cobj) => {
          if (!frameOffsets[cobj.id] && !groupOffsets[cobj.id] && cobj.id !== frameId) {
            frameOffsets[cobj.id] = { dx: cobj.x - frame.x, dy: cobj.y - frame.y };
            dragStartPosRef.current[cobj.id] = { x: cobj.x, y: cobj.y };
          }
        });
      }
    }
    frameContainedRef.current = frameOffsets;
  }, [viewport, stageRef, objectsRef, getObjectsInFrame, dragStartPosRef, frameContainedRef, selectedIdsRef]);

  const onMouseMove = useCallback(
    (canvasPoint: { x: number; y: number }) => {
      if (!frameManualDrag) return;

      const { frameId, startMouseX, startMouseY, startFrameX, startFrameY, groupOffsets } = frameManualDrag;
      const dx = canvasPoint.x - startMouseX;
      const dy = canvasPoint.y - startMouseY;
      const newX = startFrameX + dx;
      const newY = startFrameY + dy;

      const newPositions: Record<string, { x: number; y: number }> = {
        [frameId]: { x: newX, y: newY },
      };

      // Move frame-contained children
      const frameOffsets = frameContainedRef.current;
      for (const [cid, offset] of Object.entries(frameOffsets)) {
        newPositions[cid] = { x: newX + offset.dx, y: newY + offset.dy };
      }

      // Move other selected objects in the group
      for (const [sid, offset] of Object.entries(groupOffsets)) {
        newPositions[sid] = { x: newX + offset.dx, y: newY + offset.dy };
      }

      const frameParentMap: Record<string, string | null> = { [frameId]: null };
      for (const cid of Object.keys(newPositions)) {
        if (cid !== frameId) {
          frameParentMap[cid] = objectsRef.current[cid]?.parentFrameId ?? null;
        }
      }
      scheduleDragStateUpdate(newPositions, frameParentMap);

      // Use setNodeTopLeft for non-frame objects in the group for smooth visual update
      const stage = stageRef.current;
      if (stage) {
        for (const [sid, offset] of Object.entries(groupOffsets)) {
          const sobj = objectsRef.current[sid];
          if (sobj && sobj.type !== "frame") {
            const node = stage.findOne(`#node-${sid}`);
            if (node) {
              const sx = newX + offset.dx;
              const sy = newY + offset.dy;
              if (sobj.type === "sticky" || sobj.type === "rectangle" || sobj.type === "circle") {
                node.x(sx + sobj.width / 2);
                node.y(sy + sobj.height / 2);
              } else {
                node.x(sx);
                node.y(sy);
              }
            }
          }
        }
      }

      const frameNow = performance.now();
      if (frameNow - lastBroadcastRef.current >= BROADCAST_INTERVAL) {
        lastBroadcastRef.current = frameNow;
        for (const [movedId, pos] of Object.entries(newPositions)) {
          const pf = frameParentMap[movedId] ?? null;
          onObjectDragBroadcast(movedId, pos.x, pos.y, pf);
          lastDragBroadcastRef.current[movedId] = { x: pos.x, y: pos.y, parentFrameId: pf };
        }
      }
    },
    [
      frameManualDrag,
      frameContainedRef,
      objectsRef,
      stageRef,
      scheduleDragStateUpdate,
      lastBroadcastRef,
      lastDragBroadcastRef,
      BROADCAST_INTERVAL,
      onObjectDragBroadcast,
    ]
  );

  const onMouseUp = useCallback((): boolean => {
    if (!frameManualDrag) return false;

    const { frameId, groupOffsets } = frameManualDrag;
    const draggedPos = dragPositions[frameId];
    const batchUndoActions: UndoAction[] = [];

    if (draggedPos) {
      onUpdateObject(frameId, { x: draggedPos.x, y: draggedPos.y });

      const frameOffsets = frameContainedRef.current;
      for (const cid of Object.keys(frameOffsets)) {
        const cpos = dragPositions[cid];
        if (cpos) {
          onUpdateObject(cid, { x: cpos.x, y: cpos.y });
          const pf = objectsRef.current[cid]?.parentFrameId ?? null;
          onObjectDragBroadcast(cid, cpos.x, cpos.y, pf);
          onObjectDragEndBroadcast(cid);
        }
      }

      // Commit group-dragged objects (with frame containment detection)
      const allFrames = Object.values(objectsRef.current).filter((o) => o.type === "frame");
      for (const sid of Object.keys(groupOffsets)) {
        const spos = dragPositions[sid];
        if (spos) {
          const sobj = objectsRef.current[sid];
          let finalSX = spos.x;
          let finalSY = spos.y;

          // Detect frame containment for each group object (non-frame types only)
          let newParentFrameId: string | null = sobj?.parentFrameId ?? null;
          if (sobj && sobj.type !== "frame" && allFrames.length > 0) {
            const centerX = finalSX + sobj.width / 2;
            const centerY = finalSY + sobj.height / 2;
            const targetFrame = getFrameAtPoint(centerX, centerY);
            newParentFrameId = targetFrame?.id ?? null;

            const constrained = constrainObjectOutsideFrames(
              { x: finalSX, y: finalSY, width: sobj.width, height: sobj.height },
              allFrames,
              newParentFrameId
            );
            finalSX = constrained.x;
            finalSY = constrained.y;
          }

          const oldParent = sobj?.parentFrameId ?? null;
          onUpdateObject(sid, { x: finalSX, y: finalSY, parentFrameId: newParentFrameId });
          onObjectDragBroadcast(sid, finalSX, finalSY, newParentFrameId);
          onObjectDragEndBroadcast(sid);

          const sStart = dragStartPosRef.current[sid];
          if (sStart && (sStart.x !== finalSX || sStart.y !== finalSY || oldParent !== newParentFrameId)) {
            batchUndoActions.push({
              type: "update_object",
              objectId: sid,
              before: { x: sStart.x, y: sStart.y, parentFrameId: oldParent },
              after: { x: finalSX, y: finalSY, parentFrameId: newParentFrameId },
            });
          }
        }
      }

      onObjectDragBroadcast(frameId, draggedPos.x, draggedPos.y, null);
      onObjectDragEndBroadcast(frameId);

      const startPos = dragStartPosRef.current[frameId];
      if (startPos && (startPos.x !== draggedPos.x || startPos.y !== draggedPos.y)) {
        batchUndoActions.push({
          type: "update_object",
          objectId: frameId,
          before: { x: startPos.x, y: startPos.y },
          after: { x: draggedPos.x, y: draggedPos.y },
        });
      }
    }

    if (batchUndoActions.length > 0) {
      onPushUndo(
        batchUndoActions.length === 1
          ? batchUndoActions[0]
          : { type: "batch", actions: batchUndoActions }
      );
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
    objectsRef,
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
