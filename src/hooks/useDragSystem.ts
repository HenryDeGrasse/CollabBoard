import { useState, useCallback, useRef, useEffect } from "react";
import Konva from "konva";
import type { BoardObject } from "../types/board";
import type { UndoAction } from "./useUndoRedo";
import {
  constrainObjectOutsideFrames,
  shouldPopOutFromFrame,
} from "../utils/frame-containment";

const BROADCAST_INTERVAL = 50;

/** When total dragged objects (primary + group + frame children) reaches this,
 *  skip React state updates during drag and rely solely on direct Konva node
 *  manipulation via setNodeTopLeft. Positions are committed on drag end. */
const BULK_DRAG_THRESHOLD = 20;

export interface UseDragSystemParams {
  objectsRef: React.MutableRefObject<Record<string, BoardObject>>;
  selectedIds: Set<string>;
  selectedIdsRef: React.MutableRefObject<Set<string>>;
  stageRef: React.RefObject<Konva.Stage | null>;
  dragInsideFrameRef: React.MutableRefObject<Set<string>>;
  /** Ref tracking whether a frame manual drag is in progress (for heartbeat) */
  frameManualDragActiveRef: React.MutableRefObject<boolean>;
  onUpdateObject: (id: string, updates: Partial<BoardObject>) => void;
  onObjectDragBroadcast: (
    objectId: string,
    x: number,
    y: number,
    parentFrameId?: string | null,
    width?: number,
    height?: number
  ) => void;
  onObjectDragEndBroadcast: (objectId: string) => void;
  onCursorMove: (x: number, y: number) => void;
  onPushUndo: (action: UndoAction) => void;
  getFrameAtPoint: (x: number, y: number) => BoardObject | null;
  getObjectsInFrame: (frameId: string) => BoardObject[];
}

export interface UseDragSystemReturn {
  dragPositions: Record<string, { x: number; y: number }>;
  dragParentFrameIds: Record<string, string | null>;
  draggingRef: React.MutableRefObject<Set<string>>;
  frameContainedRef: React.MutableRefObject<Record<string, { dx: number; dy: number }>>;
  dragStartPosRef: React.MutableRefObject<Record<string, { x: number; y: number }>>;
  groupDragOffsetsRef: React.MutableRefObject<Record<string, { dx: number; dy: number }>>;
  lastBroadcastRef: React.MutableRefObject<number>;
  lastDragBroadcastRef: React.MutableRefObject<Record<string, { x: number; y: number; parentFrameId: string | null }>>;
  BROADCAST_INTERVAL: number;
  clearDragPositionsSoon: () => void;
  scheduleDragStateUpdate: (
    positions: Record<string, { x: number; y: number }>,
    parentMap: Record<string, string | null>
  ) => void;
  handleDragStart: (id: string) => void;
  handleDragMove: (id: string, x: number, y: number) => void;
  handleDragEnd: (id: string, x: number, y: number) => void;
  setNodeTopLeft: (nodeId: string, topLeftX: number, topLeftY: number) => void;
}

export function useDragSystem({
  objectsRef,
  selectedIds: _selectedIds,
  selectedIdsRef,
  stageRef,
  dragInsideFrameRef,
  frameManualDragActiveRef,
  onUpdateObject,
  onObjectDragBroadcast,
  onObjectDragEndBroadcast,
  onCursorMove,
  onPushUndo,
  getFrameAtPoint,
  getObjectsInFrame,
}: UseDragSystemParams): UseDragSystemReturn {
  // Live position overrides during drag — triggers re-render so connectors update
  const [dragPositions, setDragPositions] = useState<Record<string, { x: number; y: number }>>({});
  const [dragParentFrameIds, setDragParentFrameIds] = useState<Record<string, string | null>>({});
  const dragClearTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // rAF-based drag state flusher
  const rafIdRef = useRef<number | null>(null);
  const pendingDragPositionsRef = useRef<Record<string, { x: number; y: number }> | null>(null);
  const pendingDragParentFrameIdsRef = useRef<Record<string, string | null> | null>(null);

  // Ref to access dragPositions without closing over state
  const dragPositionsRef = useRef<Record<string, { x: number; y: number }>>({});
  dragPositionsRef.current = dragPositions;

  // Object drag tracking refs
  const draggingRef = useRef<Set<string>>(new Set());
  const dragStartPosRef = useRef<Record<string, { x: number; y: number }>>({});
  const groupDragOffsetsRef = useRef<Record<string, { dx: number; dy: number }>>({});
  const frameContainedRef = useRef<Record<string, { dx: number; dy: number }>>({});

  // Cached frame list — updated lazily in handleDragMove to avoid
  // scanning all objects on every move event.
  const framesRef = useRef<BoardObject[]>([]);
  const framesObjectsGenRef = useRef<Record<string, BoardObject> | null>(null);

  // Bulk drag mode: when many objects are selected, skip scheduleDragStateUpdate
  // (no React re-renders during drag) and rely on setNodeTopLeft for visuals.
  const isBulkDraggingRef = useRef(false);

  // Broadcast throttling
  const lastBroadcastRef = useRef<number>(0);
  const lastDragBroadcastRef = useRef<
    Record<string, { x: number; y: number; parentFrameId: string | null }>
  >({});

  const clearDragPositionsSoon = useCallback(() => {
    if (rafIdRef.current !== null) {
      cancelAnimationFrame(rafIdRef.current);
      rafIdRef.current = null;
    }
    pendingDragPositionsRef.current = null;
    pendingDragParentFrameIdsRef.current = null;

    if (dragClearTimerRef.current) {
      clearTimeout(dragClearTimerRef.current);
    }
    dragClearTimerRef.current = setTimeout(() => {
      setDragPositions({});
      setDragParentFrameIds({});
      dragClearTimerRef.current = null;
    }, 120);
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (dragClearTimerRef.current) {
        clearTimeout(dragClearTimerRef.current);
      }
      if (rafIdRef.current !== null) {
        cancelAnimationFrame(rafIdRef.current);
      }
    };
  }, []);

  // Accumulate drag state into pending refs and schedule a single rAF flush
  const scheduleDragStateUpdate = useCallback(
    (
      positions: Record<string, { x: number; y: number }>,
      parentMap: Record<string, string | null>
    ) => {
      pendingDragPositionsRef.current = {
        ...(pendingDragPositionsRef.current ?? {}),
        ...positions,
      };
      pendingDragParentFrameIdsRef.current = {
        ...(pendingDragParentFrameIdsRef.current ?? {}),
        ...parentMap,
      };

      if (rafIdRef.current !== null) return;
      rafIdRef.current = requestAnimationFrame(() => {
        rafIdRef.current = null;

        const pos = pendingDragPositionsRef.current;
        const frames = pendingDragParentFrameIdsRef.current;
        pendingDragPositionsRef.current = null;
        pendingDragParentFrameIdsRef.current = null;

        if (pos) setDragPositions(pos);
        if (frames) setDragParentFrameIds((prev) => ({ ...prev, ...frames }));
      });
    },
    []
  );

  // Heartbeat: re-broadcast drag positions while holding still
  useEffect(() => {
    const HEARTBEAT_MS = 600;
    const id = setInterval(() => {
      const positions = lastDragBroadcastRef.current;
      if (Object.keys(positions).length === 0) return;
      if (!frameManualDragActiveRef.current && draggingRef.current.size === 0) {
        lastDragBroadcastRef.current = {};
        return;
      }
      for (const [oid, pos] of Object.entries(positions)) {
        onObjectDragBroadcast(oid, pos.x, pos.y, pos.parentFrameId);
      }
    }, HEARTBEAT_MS);
    return () => clearInterval(id);
  }, [onObjectDragBroadcast, frameManualDragActiveRef]);

  // Helper: set Konva node position accounting for center-offset (shapes/stickies)
  const setNodeTopLeft = useCallback(
    (nodeId: string, topLeftX: number, topLeftY: number) => {
      const stageNode = stageRef.current;
      if (!stageNode) return;
      const node = stageNode.findOne(`#node-${nodeId}`);
      if (!node) return;
      const obj = objectsRef.current[nodeId];
      if (obj && (obj.type === "sticky" || obj.type === "rectangle" || obj.type === "circle")) {
        node.x(topLeftX + obj.width / 2);
        node.y(topLeftY + obj.height / 2);
      } else {
        node.x(topLeftX);
        node.y(topLeftY);
      }
    },
    [stageRef, objectsRef]
  );

  const handleDragStart = useCallback((id: string) => {
    draggingRef.current.add(id);
    const obj = objectsRef.current[id];
    if (obj) {
      dragStartPosRef.current[id] = { x: obj.x, y: obj.y };
      if (obj.parentFrameId) dragInsideFrameRef.current.add(id);
    }

    // Collect children for ALL frames being dragged (primary + selected).
    const frameOffsets: Record<string, { dx: number; dy: number }> = {};
    const collectFrameChildren = (frameId: string) => {
      getObjectsInFrame(frameId).forEach((cobj) => {
        if (!frameOffsets[cobj.id]) {
          frameOffsets[cobj.id] = { dx: cobj.x - obj!.x, dy: cobj.y - obj!.y };
          dragStartPosRef.current[cobj.id] = { x: cobj.x, y: cobj.y };
        }
      });
    };

    if (obj && obj.type === "frame") {
      collectFrameChildren(obj.id);
    }

    // If this object is part of a multi-selection, record offsets for group drag
    const currentSelectedIds = selectedIdsRef.current;
    if (currentSelectedIds.has(id) && currentSelectedIds.size > 1) {
      const offsets: Record<string, { dx: number; dy: number }> = {};
      currentSelectedIds.forEach((sid) => {
        if (sid !== id) {
          const sobj = objectsRef.current[sid];
          if (sobj && obj) {
            offsets[sid] = { dx: sobj.x - obj.x, dy: sobj.y - obj.y };
            dragStartPosRef.current[sid] = { x: sobj.x, y: sobj.y };
            if (sobj.type === "frame") {
              getObjectsInFrame(sobj.id).forEach((cobj) => {
                if (!frameOffsets[cobj.id] && !offsets[cobj.id] && cobj.id !== id) {
                  frameOffsets[cobj.id] = { dx: cobj.x - obj.x, dy: cobj.y - obj.y };
                  dragStartPosRef.current[cobj.id] = { x: cobj.x, y: cobj.y };
                }
              });
            }
          }
        }
      });
      groupDragOffsetsRef.current = offsets;
    } else {
      groupDragOffsetsRef.current = {};
    }

    frameContainedRef.current = frameOffsets;

    // Detect bulk drag mode based on total objects being dragged
    const totalDragged = 1 + Object.keys(groupDragOffsetsRef.current).length + Object.keys(frameOffsets).length;
    isBulkDraggingRef.current = totalDragged >= BULK_DRAG_THRESHOLD;
  }, [selectedIdsRef, getObjectsInFrame, objectsRef, dragInsideFrameRef]);

  const handleDragMove = useCallback(
    (id: string, x: number, y: number) => {
      const stage = stageRef.current;
      const draggedObj = objectsRef.current[id];
      let primaryX = x;
      let primaryY = y;
      let primaryParentFrameId: string | null | undefined = draggedObj?.parentFrameId ?? null;

      // Lazily rebuild cached frame list when the objects record changes.
      if (framesObjectsGenRef.current !== objectsRef.current) {
        framesObjectsGenRef.current = objectsRef.current;
        framesRef.current = Object.values(objectsRef.current)
          .filter((o) => o.type === "frame")
          .sort((a, b) => (b.zIndex || 0) - (a.zIndex || 0));
      }
      const cachedFrames = framesRef.current;

      // ── Bulk drag fast path ──
      // When many objects are dragged, skip frame constraints and React state
      // updates. Only update Konva node positions directly via setNodeTopLeft.
      if (isBulkDraggingRef.current) {
        // Position the primary node
        if (stage) setNodeTopLeft(id, primaryX, primaryY);

        // Move frame-contained objects
        for (const [cid, offset] of Object.entries(frameContainedRef.current)) {
          if (stage) setNodeTopLeft(cid, primaryX + offset.dx, primaryY + offset.dy);
        }

        // Move other selected objects in the group
        for (const [sid, offset] of Object.entries(groupDragOffsetsRef.current)) {
          if (stage) setNodeTopLeft(sid, primaryX + offset.dx, primaryY + offset.dy);
        }

        // Throttled broadcast — all dragged objects (primary + group + frame children)
        const now = performance.now();
        if (now - lastBroadcastRef.current >= BROADCAST_INTERVAL) {
          lastBroadcastRef.current = now;

          onObjectDragBroadcast(id, primaryX, primaryY, primaryParentFrameId ?? null);
          lastDragBroadcastRef.current[id] = { x: primaryX, y: primaryY, parentFrameId: primaryParentFrameId ?? null };

          for (const [cid, offset] of Object.entries(frameContainedRef.current)) {
            const bx = primaryX + offset.dx;
            const by = primaryY + offset.dy;
            const pf = objectsRef.current[cid]?.parentFrameId ?? null;
            onObjectDragBroadcast(cid, bx, by, pf);
            lastDragBroadcastRef.current[cid] = { x: bx, y: by, parentFrameId: pf };
          }

          for (const [sid, offset] of Object.entries(groupDragOffsetsRef.current)) {
            const bx = primaryX + offset.dx;
            const by = primaryY + offset.dy;
            const pf = objectsRef.current[sid]?.parentFrameId ?? null;
            onObjectDragBroadcast(sid, bx, by, pf);
            lastDragBroadcastRef.current[sid] = { x: bx, y: by, parentFrameId: pf };
          }

          if (stage) {
            const pointer = stage.getPointerPosition();
            if (pointer) {
              const cx = (pointer.x - stage.x()) / stage.scaleX();
              const cy = (pointer.y - stage.y()) / stage.scaleY();
              onCursorMove(cx, cy);
            }
          }
        }
        return; // Skip scheduleDragStateUpdate — no React re-renders during bulk drag
      }

      // ── Normal drag path ──

      // Prevent non-frame objects from sliding under frames while cursor is outside.
      const isGroupDrag = selectedIdsRef.current.has(id) && selectedIdsRef.current.size > 1;
      if (draggedObj && draggedObj.type !== "frame" && !isGroupDrag && cachedFrames.length > 0) {
        const pointer = stage?.getPointerPosition();
        let frameUnderCursorId: string | null = null;
        if (pointer && stage) {
          const cx = (pointer.x - stage.x()) / stage.scaleX();
          const cy = (pointer.y - stage.y()) / stage.scaleY();
          frameUnderCursorId = getFrameAtPoint(cx, cy)?.id ?? null;
        }

        let allowedFrameId = frameUnderCursorId;

        const currentParentFrameId = draggedObj.parentFrameId ?? null;
        if (currentParentFrameId && allowedFrameId === currentParentFrameId) {
          const currentParentFrame = objectsRef.current[currentParentFrameId];
          if (currentParentFrame && currentParentFrame.type === "frame") {
            const wasInside = dragInsideFrameRef.current.has(id);
            const threshold = wasInside ? 0.45 : 0.55;
            const willPopOut = shouldPopOutFromFrame(
              { x: primaryX, y: primaryY, width: draggedObj.width, height: draggedObj.height },
              {
                x: currentParentFrame.x,
                y: currentParentFrame.y,
                width: currentParentFrame.width,
                height: currentParentFrame.height,
              },
              threshold
            );
            if (willPopOut) {
              allowedFrameId = null;
            }
          }
        }

        if (!allowedFrameId && !currentParentFrameId) {
          const wasInside = dragInsideFrameRef.current.has(id);
          const threshold = wasInside ? 0.45 : 0.55;

          for (const frame of cachedFrames) {
            const isInside = !shouldPopOutFromFrame(
              { x: primaryX, y: primaryY, width: draggedObj.width, height: draggedObj.height },
              { x: frame.x, y: frame.y, width: frame.width, height: frame.height },
              threshold
            );
            if (isInside) {
              allowedFrameId = frame.id;
              dragInsideFrameRef.current.add(id);
              break;
            }
          }
          if (!allowedFrameId && wasInside) {
            dragInsideFrameRef.current.delete(id);
          }
        }

        primaryParentFrameId = allowedFrameId ?? null;

        const constrained = constrainObjectOutsideFrames(
          { x: primaryX, y: primaryY, width: draggedObj.width, height: draggedObj.height },
          cachedFrames,
          allowedFrameId
        );
        primaryX = constrained.x;
        primaryY = constrained.y;

        if (stage) {
          setNodeTopLeft(id, primaryX, primaryY);
          const node = stage.findOne(`#node-${id}`);
          if (node) {
            node.opacity(allowedFrameId && !currentParentFrameId ? 0 : 1);
          }
        }
      }

      // Build live positions for all dragged items
      const positions: Record<string, { x: number; y: number }> = {
        [id]: { x: primaryX, y: primaryY },
      };
      const parentFrameMap: Record<string, string | null> = {
        [id]: primaryParentFrameId ?? (draggedObj?.parentFrameId ?? null),
      };

      // Move frame-contained objects
      const frameOffsets = frameContainedRef.current;
      for (const [cid, offset] of Object.entries(frameOffsets)) {
        const newX = primaryX + offset.dx;
        const newY = primaryY + offset.dy;
        positions[cid] = { x: newX, y: newY };
        parentFrameMap[cid] = objectsRef.current[cid]?.parentFrameId ?? null;
        if (stage) setNodeTopLeft(cid, newX, newY);
      }

      // Move other selected objects in the group
      const offsets = groupDragOffsetsRef.current;
      for (const [sid, offset] of Object.entries(offsets)) {
        const newX = primaryX + offset.dx;
        const newY = primaryY + offset.dy;
        positions[sid] = { x: newX, y: newY };
        parentFrameMap[sid] = objectsRef.current[sid]?.parentFrameId ?? null;
        if (stage) setNodeTopLeft(sid, newX, newY);
      }

      scheduleDragStateUpdate(positions, parentFrameMap);

      // Throttled broadcast
      const now = performance.now();
      if (now - lastBroadcastRef.current >= BROADCAST_INTERVAL) {
        lastBroadcastRef.current = now;
        for (const [movedId, pos] of Object.entries(positions)) {
          const pf = parentFrameMap[movedId] ?? null;
          onObjectDragBroadcast(movedId, pos.x, pos.y, pf);
          lastDragBroadcastRef.current[movedId] = { x: pos.x, y: pos.y, parentFrameId: pf };
        }
        if (stage) {
          const pointer = stage.getPointerPosition();
          if (pointer) {
            const cx = (pointer.x - stage.x()) / stage.scaleX();
            const cy = (pointer.y - stage.y()) / stage.scaleY();
            onCursorMove(cx, cy);
          }
        }
      }
    },
    [
      stageRef,
      objectsRef,
      dragInsideFrameRef,
      onCursorMove,
      onObjectDragBroadcast,
      selectedIdsRef,
      getFrameAtPoint,
      scheduleDragStateUpdate,
      setNodeTopLeft,
    ]
  );

  const handleDragEnd = useCallback(
    (id: string, x: number, y: number) => {
      // ── Bulk drag end: commit all positions from start + delta ──
      if (isBulkDraggingRef.current) {
        const primaryStart = dragStartPosRef.current[id];
        const dx = primaryStart ? x - primaryStart.x : 0;
        const dy = primaryStart ? y - primaryStart.y : 0;

        const batchUndoActions: UndoAction[] = [];
        const allDragStarts = dragStartPosRef.current;

        for (const [oid, oStart] of Object.entries(allDragStarts)) {
          const finalX = oStart.x + dx;
          const finalY = oStart.y + dy;
          onUpdateObject(oid, { x: finalX, y: finalY });
          if (dx !== 0 || dy !== 0) {
            batchUndoActions.push({
              type: "update_object",
              objectId: oid,
              before: { x: oStart.x, y: oStart.y },
              after: { x: finalX, y: finalY },
            });
          }
        }

        // Broadcast final positions and drag end
        for (const [oid, oStart] of Object.entries(allDragStarts)) {
          const finalX = oStart.x + dx;
          const finalY = oStart.y + dy;
          const obj = objectsRef.current[oid];
          onObjectDragBroadcast(oid, finalX, finalY, obj?.parentFrameId ?? null);
          onObjectDragEndBroadcast(oid);
        }

        if (batchUndoActions.length > 0) {
          onPushUndo(
            batchUndoActions.length === 1
              ? batchUndoActions[0]
              : { type: "batch", actions: batchUndoActions }
          );
        }

        // Clean up all bulk drag state
        isBulkDraggingRef.current = false;
        draggingRef.current.clear();
        dragStartPosRef.current = {};
        groupDragOffsetsRef.current = {};
        frameContainedRef.current = {};
        lastDragBroadcastRef.current = {};
        dragInsideFrameRef.current.clear();
        return;
      }

      draggingRef.current.delete(id);

      // Restore opacity on the original node
      const stageNode = stageRef.current;
      if (stageNode) {
        const node = stageNode.findOne(`#node-${id}`);
        if (node) node.opacity(1);
      }

      const startPos = dragStartPosRef.current[id];
      const draggedObj = objectsRef.current[id];

      const livePos = dragPositionsRef.current[id];
      let finalX = livePos?.x ?? x;
      let finalY = livePos?.y ?? y;
      let finalParentFrameId: string | null | undefined = draggedObj?.parentFrameId ?? null;

      if (draggedObj && draggedObj.type !== "frame" && framesRef.current.length > 0) {
        const stage = stageRef.current;
        const pointer = stage?.getPointerPosition();

        let targetFrame: BoardObject | null = null;
        if (pointer && stage) {
          const cx = (pointer.x - stage.x()) / stage.scaleX();
          const cy = (pointer.y - stage.y()) / stage.scaleY();
          targetFrame = getFrameAtPoint(cx, cy);
        }

        if (!targetFrame) {
          const centerX = finalX + draggedObj.width / 2;
          const centerY = finalY + draggedObj.height / 2;
          targetFrame = getFrameAtPoint(centerX, centerY);
        }

        finalParentFrameId = targetFrame?.id ?? null;

        const constrained = constrainObjectOutsideFrames(
          { x: finalX, y: finalY, width: draggedObj.width, height: draggedObj.height },
          framesRef.current,
          finalParentFrameId ?? null
        );
        finalX = constrained.x;
        finalY = constrained.y;
      }

      onUpdateObject(id, { x: finalX, y: finalY, parentFrameId: finalParentFrameId ?? null });

      const finalPositions: Record<string, { x: number; y: number }> = {
        [id]: { x: finalX, y: finalY },
      };
      const finalParentFrameMap: Record<string, string | null> = {
        [id]: finalParentFrameId ?? (draggedObj?.parentFrameId ?? null),
      };

      const batchUndoActions: UndoAction[] = [];
      if (
        startPos &&
        (startPos.x !== finalX || startPos.y !== finalY || (draggedObj?.parentFrameId ?? null) !== (finalParentFrameId ?? null))
      ) {
        batchUndoActions.push({
          type: "update_object",
          objectId: id,
          before: { x: startPos.x, y: startPos.y, parentFrameId: draggedObj?.parentFrameId ?? null },
          after: { x: finalX, y: finalY, parentFrameId: finalParentFrameId ?? null },
        });
      }
      delete dragStartPosRef.current[id];

      // Commit frame-contained objects
      const frameOffsets = frameContainedRef.current;
      for (const [cid, offset] of Object.entries(frameOffsets)) {
        const newX = finalX + offset.dx;
        const newY = finalY + offset.dy;
        finalPositions[cid] = { x: newX, y: newY };
        finalParentFrameMap[cid] = objectsRef.current[cid]?.parentFrameId ?? null;
        const cStart = dragStartPosRef.current[cid];
        onUpdateObject(cid, { x: newX, y: newY });
        if (cStart && (cStart.x !== newX || cStart.y !== newY)) {
          batchUndoActions.push({
            type: "update_object",
            objectId: cid,
            before: { x: cStart.x, y: cStart.y },
            after: { x: newX, y: newY },
          });
        }
        delete dragStartPosRef.current[cid];
      }
      frameContainedRef.current = {};

      // Commit all other group-dragged objects
      const offsets = groupDragOffsetsRef.current;
      for (const [sid, offset] of Object.entries(offsets)) {
        const newX = finalX + offset.dx;
        const newY = finalY + offset.dy;
        finalPositions[sid] = { x: newX, y: newY };
        finalParentFrameMap[sid] = objectsRef.current[sid]?.parentFrameId ?? null;
        const sStart = dragStartPosRef.current[sid];
        onUpdateObject(sid, { x: newX, y: newY });
        if (sStart && (sStart.x !== newX || sStart.y !== newY)) {
          batchUndoActions.push({
            type: "update_object",
            objectId: sid,
            before: { x: sStart.x, y: sStart.y },
            after: { x: newX, y: newY },
          });
        }
        delete dragStartPosRef.current[sid];
      }

      // Cancel any pending rAF flush
      if (rafIdRef.current !== null) {
        cancelAnimationFrame(rafIdRef.current);
        rafIdRef.current = null;
      }
      pendingDragPositionsRef.current = null;
      pendingDragParentFrameIdsRef.current = null;

      setDragPositions(finalPositions);
      setDragParentFrameIds(finalParentFrameMap);

      // Broadcast final positions
      for (const movedId of Object.keys(finalPositions)) {
        const pos = finalPositions[movedId];
        onObjectDragBroadcast(movedId, pos.x, pos.y, finalParentFrameMap[movedId] ?? null);
        onObjectDragEndBroadcast(movedId);
      }

      groupDragOffsetsRef.current = {};
      lastDragBroadcastRef.current = {};
      clearDragPositionsSoon();
      dragInsideFrameRef.current.clear();

      if (batchUndoActions.length > 0) {
        onPushUndo(
          batchUndoActions.length === 1
            ? batchUndoActions[0]
            : { type: "batch", actions: batchUndoActions }
        );
      }
    },
    [
      objectsRef,
      dragInsideFrameRef,
      onUpdateObject,
      onPushUndo,
      onObjectDragBroadcast,
      onObjectDragEndBroadcast,
      getFrameAtPoint,
      stageRef,
      clearDragPositionsSoon,
    ]
  );

  return {
    dragPositions,
    dragParentFrameIds,
    draggingRef,
    frameContainedRef,
    dragStartPosRef,
    groupDragOffsetsRef,
    lastBroadcastRef,
    lastDragBroadcastRef,
    BROADCAST_INTERVAL,
    clearDragPositionsSoon,
    scheduleDragStateUpdate,
    handleDragStart,
    handleDragMove,
    handleDragEnd,
    setNodeTopLeft,
  };
}
