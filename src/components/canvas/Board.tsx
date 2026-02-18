import React, { useState, useCallback, useMemo, useRef, useEffect } from "react";
import { Stage, Layer, Arrow, Line, Rect, Group } from "react-konva";
import Konva from "konva";
import { StickyNote } from "./StickyNote";
import { Shape } from "./Shape";
import { LineObject } from "./LineTool";
import { Frame, FrameOverlay } from "./Frame";
import { ConnectorLine } from "./Connector";
import { RemoteCursor } from "./RemoteCursor";
import { SelectionRect } from "./SelectionRect";
import { TextOverlay } from "./TextOverlay";
import type { BoardObject, Connector } from "../../types/board";
import type { UndoAction } from "../../hooks/useUndoRedo";
import type { UserPresence } from "../../types/presence";
import type { UseCanvasReturn } from "../../hooks/useCanvas";
import { useCursorInterpolation } from "../../hooks/useCursorInterpolation";

import { getObjectIdsInRect, getConnectorIdsInRect } from "../../utils/selection";
import {
  constrainObjectOutsideFrames,
  shouldPopOutFromFrame,
  constrainChildrenInFrame,
  minFrameSizeForChildren,
} from "../../utils/frame-containment";
import { computeFrameFromGesture } from "../../utils/frame-create";
import {
  getFrameHeaderHeight,
  FRAME_HEADER_MIN_HEIGHT,
} from "../../utils/text-style";

export type ToolType = "select" | "sticky" | "rectangle" | "circle" | "arrow" | "line" | "frame";

// ─── Frame layout constants (module-level so useMemo hooks can reference them
//     before the in-component `const` declarations would be initialized) ────
const DEFAULT_TITLE_HEIGHT = FRAME_HEADER_MIN_HEIGHT;
const MIN_FRAME_WIDTH = 200;
const MIN_FRAME_HEIGHT = 150;
const DEFAULT_FRAME_WIDTH = 200;
const DEFAULT_FRAME_HEIGHT = 150;
const FRAME_CLICK_THRESHOLD = 6;
const FRAME_CONTENT_PADDING = 6;

interface BoardProps {
  objects: Record<string, BoardObject>;
  connectors: Record<string, Connector>;
  users: Record<string, UserPresence>;
  currentUserId: string;
  canvas: UseCanvasReturn;
  selectedIds: Set<string>;
  remoteDragPositions: Record<
    string,
    {
      x: number;
      y: number;
      width?: number;
      height?: number;
      parentFrameId?: string | null;
      userId: string;
      updatedAt: number;
    }
  >;
  activeTool: ToolType;
  activeColor: string;
  onSelect: (id: string, multi?: boolean) => void;
  onClearSelection: () => void;
  onCreateObject: (obj: Omit<BoardObject, "id" | "createdAt" | "updatedAt">) => string;
  onUpdateObject: (id: string, updates: Partial<BoardObject>) => void;
  onDeleteObject: (id: string) => void;
  onDeleteFrame: (frameId: string) => void;
  onCreateConnector: (conn: Omit<Connector, "id">) => string;
  onDeleteConnector: (id: string) => void;
  onCursorMove: (x: number, y: number) => void;
  onObjectDragBroadcast: (
    objectId: string,
    x: number,
    y: number,
    parentFrameId?: string | null,
    width?: number,
    height?: number
  ) => void;
  onObjectDragEndBroadcast: (objectId: string) => void;
  onSetEditingObject: (objectId: string | null) => void;
  onDraftTextChange: (objectId: string, text: string) => void;
  getDraftTextForObject: (objectId: string) => { text: string; color: string } | null;
  isObjectLocked: (objectId: string) => { locked: boolean; lockedBy?: string; lockedByColor?: string };
  onResetTool: (selectId?: string) => void;
  onPushUndo: (action: UndoAction) => void;
  onRotatingChange?: (rotating: boolean) => void;
}

export function Board({
  objects,
  connectors,
  users,
  currentUserId,
  canvas,
  selectedIds,
  remoteDragPositions,
  activeTool,
  activeColor,
  onSelect,
  onClearSelection,
  onCreateObject,
  onUpdateObject,
  onDeleteObject,
  onDeleteFrame,
  onCreateConnector,
  onDeleteConnector,
  onCursorMove,
  onObjectDragBroadcast,
  onObjectDragEndBroadcast,
  onSetEditingObject,
  onDraftTextChange,
  getDraftTextForObject,
  isObjectLocked,
  onResetTool,
  onPushUndo,
  onRotatingChange,
}: BoardProps) {
  const { viewport, setViewport, onWheel, stageRef } = canvas;
  // Stable ref for objects — used inside callbacks to avoid regenerating them
  // on every objects change. The ref is updated synchronously on every render,
  // so it is always current when any callback fires.
  const objectsRef = useRef(objects);
  objectsRef.current = objects;
  const connectorsRef = useRef(connectors);
  connectorsRef.current = connectors;
  const [editingObjectId, setEditingObjectId] = useState<string | null>(null);
  const [selectionRect, setSelectionRect] = useState({
    x: 0,
    y: 0,
    width: 0,
    height: 0,
    visible: false,
  });
  const [selectedConnectorIds, setSelectedConnectorIds] = useState<Set<string>>(new Set());
  const draggingRef = useRef<Set<string>>(new Set());
  // Track which objects are currently "inside a frame" during drag, for hysteresis
  const dragInsideFrameRef = useRef<Set<string>>(new Set());
  const selectionStartRef = useRef<{ x: number; y: number } | null>(null);
  const justFinishedSelectionRef = useRef(false);
  const [spaceHeld, setSpaceHeld] = useState(false);
  const spaceHeldRef = useRef(false);
  const rightClickPanRef = useRef<{ startX: number; startY: number; viewX: number; viewY: number } | null>(null);
  const [stageSize, setStageSize] = useState({ width: window.innerWidth, height: window.innerHeight });

  // Handle window resize
  useEffect(() => {
    const handleResize = () => {
      setStageSize({ width: window.innerWidth, height: window.innerHeight });
    };
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  const clearDragPositionsSoon = useCallback(() => {
    // Cancel any pending rAF flush so it doesn't overwrite the clear.
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
  // per display frame.  This caps React re-renders at ~60fps (or display
  // refresh rate) while letting Konva node mutations remain truly instant.
  const scheduleDragStateUpdate = useCallback(
    (
      positions: Record<string, { x: number; y: number }>,
      parentMap: Record<string, string | null>
    ) => {
      // Merge newest per-object values into the pending buckets.
      pendingDragPositionsRef.current = {
        ...(pendingDragPositionsRef.current ?? {}),
        ...positions,
      };
      pendingDragParentFrameIdsRef.current = {
        ...(pendingDragParentFrameIdsRef.current ?? {}),
        ...parentMap,
      };

      // Only schedule one rAF at a time.
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

  // Line drawing state
  const [lineDraw, setLineDraw] = useState<{
    startX: number;
    startY: number;
    endX: number;
    endY: number;
  } | null>(null);

  // Frame drawing state (drag-to-create)
  const [frameDraw, setFrameDraw] = useState<{
    startX: number;
    startY: number;
    endX: number;
    endY: number;
  } | null>(null);

  // Frame manual drag state (for dragging via overlay header)
  const [frameManualDrag, setFrameManualDrag] = useState<{
    frameId: string;
    startMouseX: number;
    startMouseY: number;
    startFrameX: number;
    startFrameY: number;
  } | null>(null);
  // Ref mirror so the heartbeat interval can read it without capturing stale closure.
  const frameManualDragRef = useRef<typeof frameManualDrag>(null);
  useEffect(() => { frameManualDragRef.current = frameManualDrag; }, [frameManualDrag]);

  // Live position overrides during drag — triggers re-render so connectors update
  const [dragPositions, setDragPositions] = useState<Record<string, { x: number; y: number }>>({});
  const [dragParentFrameIds, setDragParentFrameIds] = useState<Record<string, string | null>>({});
  const dragClearTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // rAF-based drag state flusher — accumulates position/parentFrame updates
  // in refs between pointer events, then flushes them once per animation frame
  // so React re-renders (connectors, in-frame previews) run at display refresh rate.
  const rafIdRef = useRef<number | null>(null);
  const pendingDragPositionsRef = useRef<Record<string, { x: number; y: number }> | null>(null);
  const pendingDragParentFrameIdsRef = useRef<Record<string, string | null> | null>(null);

  // Arrow drawing state
  const [arrowDraw, setArrowDraw] = useState<{
    fromId: string;
    fromX: number;
    fromY: number;
    toX: number;
    toY: number;
  } | null>(null);

  const stageWidth = stageSize.width;
  const stageHeight = stageSize.height;

  // Track space key for pan mode
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.code === "Space" && !(e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement)) {
        e.preventDefault();
        setSpaceHeld(true);
        spaceHeldRef.current = true;
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code === "Space") {
        setSpaceHeld(false);
        spaceHeldRef.current = false;
      }
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
    };
  }, []);

  // Right-click drag panning
  useEffect(() => {
    const container = stageRef.current?.container();
    if (!container) return;

    const onContextMenu = (e: Event) => {
      e.preventDefault(); // Prevent browser context menu
    };

    const onMouseDown = (e: MouseEvent) => {
      if (e.button === 2) { // Right click
        e.preventDefault();
        rightClickPanRef.current = {
          startX: e.clientX,
          startY: e.clientY,
          viewX: stageRef.current?.x() ?? 0,
          viewY: stageRef.current?.y() ?? 0,
        };
      }
    };

    const onMouseMove = (e: MouseEvent) => {
      if (!rightClickPanRef.current) return;
      const dx = e.clientX - rightClickPanRef.current.startX;
      const dy = e.clientY - rightClickPanRef.current.startY;
      const newX = rightClickPanRef.current.viewX + dx;
      const newY = rightClickPanRef.current.viewY + dy;
      setViewport((prev) => ({ ...prev, x: newX, y: newY }));
    };

    const onMouseUp = (e: MouseEvent) => {
      if (e.button === 2 && rightClickPanRef.current) {
        rightClickPanRef.current = null;
      }
    };

    container.addEventListener("contextmenu", onContextMenu);
    container.addEventListener("mousedown", onMouseDown);
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
    return () => {
      container.removeEventListener("contextmenu", onContextMenu);
      container.removeEventListener("mousedown", onMouseDown);
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    };
  }, [stageRef, setViewport]);

  // Stage is draggable (pan) only when space is held
  const isPanning = spaceHeld;

  // Note: DB writes during drag are deferred to dragEnd for local FPS.
  // Collaborators see movement via presence broadcast, not DB writes.

  // Throttled broadcast for collaborators — 50ms intervals.
  const lastBroadcastRef = useRef<number>(0);
  const BROADCAST_INTERVAL = 50;

  // Heartbeat: re-broadcast drag positions while holding still so the
  // collaborator's stale-cleanup timer doesn't evict the live preview.
  // Stores { objectId → {x, y, parentFrameId} } for the last broadcast.
  const lastDragBroadcastRef = useRef<
    Record<string, { x: number; y: number; parentFrameId: string | null }>
  >({});

  useEffect(() => {
    const HEARTBEAT_MS = 600;
    const id = setInterval(() => {
      const positions = lastDragBroadcastRef.current;
      if (Object.keys(positions).length === 0) return;
      // Only fire when an actual drag is still in progress.
      if (frameManualDragRef.current === null && draggingRef.current.size === 0) {
        lastDragBroadcastRef.current = {};
        return;
      }
      for (const [oid, pos] of Object.entries(positions)) {
        onObjectDragBroadcast(oid, pos.x, pos.y, pos.parentFrameId);
      }
    }, HEARTBEAT_MS);
    return () => clearInterval(id);
  }, [onObjectDragBroadcast]);

  // Local drag state updates are intentionally unthrottled so connector
  // and in-frame previews can keep up with pointer movement at full refresh.


  // Sort objects by zIndex for rendering order
  const sortedObjects = useMemo(
    () =>
      Object.values(objects).sort((a, b) => (a.zIndex || 0) - (b.zIndex || 0)),
    [objects]
  );

  // Pre-computed map: frameId → contained objects (O(N) once, O(1) per lookup).
  // Used in the render path instead of calling getObjectsInFrame per frame.
  const objectsByFrame = useMemo(() => {
    const map: Record<string, BoardObject[]> = {};
    for (const obj of Object.values(objects)) {
      if (obj.parentFrameId && obj.type !== "frame") {
        if (!map[obj.parentFrameId]) map[obj.parentFrameId] = [];
        map[obj.parentFrameId].push(obj);
      }
    }
    return map;
  }, [objects]);

  // Pre-computed map: frameId → intra-frame connectors (both endpoints in same frame).
  const connectorsByFrame = useMemo(() => {
    const map: Record<string, typeof connectors[string][]> = {};
    for (const conn of Object.values(connectors)) {
      const fromFrame = objects[conn.fromId]?.parentFrameId;
      const toFrame = objects[conn.toId]?.parentFrameId;
      if (fromFrame && fromFrame === toFrame) {
        if (!map[fromFrame]) map[fromFrame] = [];
        map[fromFrame].push(conn);
      }
    }
    return map;
  }, [connectors, objects]);

  // Per-frame minimum resize dimensions based on the largest contained child.
  // Ensures the frame can't be shrunk smaller than its biggest child + padding.
  const frameMinSizes = useMemo(() => {
    const sizes: Record<string, { minWidth: number; minHeight: number }> = {};
    for (const [frameId, children] of Object.entries(objectsByFrame)) {
      const frameObj = objects[frameId];
      const titleHeight =
        frameObj && frameObj.type === "frame"
          ? getFrameHeaderHeight(frameObj)
          : DEFAULT_TITLE_HEIGHT;

      sizes[frameId] = minFrameSizeForChildren(
        children,
        titleHeight,
        FRAME_CONTENT_PADDING,
        MIN_FRAME_WIDTH,
        MIN_FRAME_HEIGHT
      );
    }
    return sizes;
  }, [objectsByFrame, objects]);

  // Tracks the state at resize start so we can build an undo batch on resize end.
  const frameResizeTrackRef = useRef<{
    frameId: string;
    startFrame: { x: number; y: number; width: number; height: number };
    startChildren: Record<string, { x: number; y: number }>;
    movedChildIds: Set<string>;
  } | null>(null);

  // Single-pass partition of objects by type/containment for render.
  // Replaces 6 separate .filter() chains (O(6N) → O(N)).
  const partitionedObjects = useMemo(() => {
    const uncontainedShapes: BoardObject[] = [];
    const uncontainedStickies: BoardObject[] = [];
    const frames: BoardObject[] = [];
    const lines: BoardObject[] = [];

    for (const obj of sortedObjects) {
      if (obj.type === "frame") {
        frames.push(obj);
      } else if (obj.type === "line") {
        lines.push(obj);
      } else if (!obj.parentFrameId) {
        if (obj.type === "sticky") {
          uncontainedStickies.push(obj);
        } else if (obj.type === "rectangle" || obj.type === "circle") {
          uncontainedShapes.push(obj);
        }
      }
    }

    return { uncontainedShapes, uncontainedStickies, frames, lines };
  }, [sortedObjects]);

  const liveDragPositions = useMemo(() => {
    const merged: Record<string, { x: number; y: number; width?: number; height?: number }> = {};

    for (const [id, pos] of Object.entries(remoteDragPositions)) {
      merged[id] = {
        x: pos.x,
        y: pos.y,
        ...(typeof pos.width === "number" ? { width: pos.width } : {}),
        ...(typeof pos.height === "number" ? { height: pos.height } : {}),
      };
    }

    // Local drag preview takes precedence over remote preview for same object id.
    for (const [id, pos] of Object.entries(dragPositions)) {
      merged[id] = { ...merged[id], ...pos };
    }

    return merged;
  }, [remoteDragPositions, dragPositions]);

  const liveParentFrameIds = useMemo(() => {
    const merged: Record<string, string | null> = {};

    for (const [id, pos] of Object.entries(remoteDragPositions)) {
      if (pos.parentFrameId !== undefined) {
        merged[id] = pos.parentFrameId;
      }
    }

    for (const [id, parentFrameId] of Object.entries(dragParentFrameIds)) {
      merged[id] = parentFrameId;
    }

    return merged;
  }, [remoteDragPositions, dragParentFrameIds]);

  // Resolve live positions for rendering:
  // - explicit drag packets (local/remote) always win
  // - if a frame moves but some child packets are delayed/dropped,
  //   derive child preview positions from frame delta so motion stays cohesive.
  const resolvedLiveDragPositions = useMemo(() => {
    const resolved: Record<string, { x: number; y: number; width?: number; height?: number }> = {
      ...liveDragPositions,
    };

    const frames = Object.values(objects).filter((o) => o.type === "frame");
    if (frames.length === 0) return resolved;

    for (const frame of frames) {
      const liveFrame = liveDragPositions[frame.id];
      if (!liveFrame) continue;

      const dx = liveFrame.x - frame.x;
      const dy = liveFrame.y - frame.y;
      if (dx === 0 && dy === 0) continue;

      for (const obj of Object.values(objects)) {
        if (obj.type === "frame" || obj.parentFrameId !== frame.id) continue;
        if (resolved[obj.id]) continue;

        resolved[obj.id] = {
          x: obj.x + dx,
          y: obj.y + dy,
        };
      }
    }

    return resolved;
  }, [liveDragPositions, objects]);

  // Pre-compute objects with live drag positions applied.
  // Caches merged objects between renders to preserve referential equality
  // and reduce GC pressure from per-object spread on every render.
  const livePositionCacheRef = useRef<Map<string, BoardObject>>(new Map());
  const objectsWithLivePositions = useMemo(() => {
    const cache = livePositionCacheRef.current;
    const result: Record<string, BoardObject> = {};

    for (const [id, obj] of Object.entries(objects)) {
      const live = resolvedLiveDragPositions[id];
      if (!live) {
        result[id] = obj; // No copy needed — original reference
        cache.delete(id);
        continue;
      }

      const cached = cache.get(id);
      if (
        cached &&
        cached.x === live.x &&
        cached.y === live.y &&
        (live.width === undefined || cached.width === live.width) &&
        (live.height === undefined || cached.height === live.height)
      ) {
        result[id] = cached; // Reuse cached merged object
      } else {
        const merged = { ...obj, ...live };
        cache.set(id, merged);
        result[id] = merged;
      }
    }

    // Clean stale entries
    for (const cachedId of cache.keys()) {
      if (!objects[cachedId]) cache.delete(cachedId);
    }

    return result;
  }, [objects, resolvedLiveDragPositions]);

  const withLivePosition = useCallback(
    (obj: BoardObject): BoardObject => {
      return objectsWithLivePositions[obj.id] || obj;
    },
    [objectsWithLivePositions]
  );

  const poppedOutDraggedObjects = useMemo(() => {
    return Object.values(objects)
      .filter((obj) => !!obj.parentFrameId && !!liveDragPositions[obj.id])
      .map((obj) => {
        const live = liveDragPositions[obj.id]!;
        const parent = obj.parentFrameId ? objects[obj.parentFrameId] : undefined;
        if (!parent || parent.type !== "frame") return null;

        // Hysteresis: objects currently inside use lower exit threshold (0.45)
        const wasInside = dragInsideFrameRef.current.has(obj.id);
        const threshold = wasInside ? 0.45 : 0.5;
        const shouldPop = shouldPopOutFromFrame(
          { x: live.x, y: live.y, width: obj.width, height: obj.height },
          { x: parent.x, y: parent.y, width: parent.width, height: parent.height },
          threshold
        );

        if (shouldPop) {
          dragInsideFrameRef.current.delete(obj.id);
          return { ...obj, x: live.x, y: live.y };
        } else {
          dragInsideFrameRef.current.add(obj.id);
          return null;
        }
      })
      .filter((obj): obj is BoardObject => !!obj)
      .sort((a, b) => (a.zIndex || 0) - (b.zIndex || 0));
  }, [objects, liveDragPositions]);

  // IDs of objects currently being dragged out of their frame (for connector rendering)
  const poppedOutDraggedObjectIds = useMemo(
    () => new Set(poppedOutDraggedObjects.map((o) => o.id)),
    [poppedOutDraggedObjects]
  );

  // While dragging uncontained objects into a frame, show a live in-frame preview.
  // Hysteresis: entering uses higher threshold (0.55), staying in uses lower (0.45).
  const enteringFrameDraggedObjects = useMemo(() => {
    const frames = Object.values(objects)
      .filter((o) => o.type === "frame")
      .sort((a, b) => (b.zIndex || 0) - (a.zIndex || 0));

    return Object.values(objects)
      .filter((obj) => !obj.parentFrameId && !!liveDragPositions[obj.id] && obj.type !== "frame")
      .map((obj) => {
        const live = liveDragPositions[obj.id]!;

        // If drag source provided an explicit frame membership preview, trust it.
        const forcedFrameId = liveParentFrameIds[obj.id];
        if (forcedFrameId) {
          const forcedFrame = frames.find((f) => f.id === forcedFrameId);
          if (forcedFrame) {
            dragInsideFrameRef.current.add(obj.id);
            return {
              frameId: forcedFrame.id,
              object: { ...obj, x: live.x, y: live.y } as BoardObject,
            };
          }
        }

        const wasInside = dragInsideFrameRef.current.has(obj.id);
        const threshold = wasInside ? 0.45 : 0.55;

        const targetFrame = frames.find((frame) => {
          return !shouldPopOutFromFrame(
            { x: live.x, y: live.y, width: obj.width, height: obj.height },
            { x: frame.x, y: frame.y, width: frame.width, height: frame.height },
            threshold
          );
        });

        if (targetFrame) {
          dragInsideFrameRef.current.add(obj.id);
          return {
            frameId: targetFrame.id,
            object: { ...obj, x: live.x, y: live.y } as BoardObject,
          };
        } else {
          dragInsideFrameRef.current.delete(obj.id);
          return null;
        }
      })
      .filter((entry): entry is { frameId: string; object: BoardObject } => !!entry);
  }, [objects, liveDragPositions, liveParentFrameIds]);

  const remoteEnteringDraggedObjectIds = useMemo(() => {
    const ids = new Set<string>();
    for (const entry of enteringFrameDraggedObjects) {
      const id = entry.object.id;
      if (remoteDragPositions[id] && !dragPositions[id]) {
        ids.add(id);
      }
    }
    return ids;
  }, [enteringFrameDraggedObjects, remoteDragPositions, dragPositions]);

  const remotePoppedOutDraggedObjectIds = useMemo(() => {
    const ids = new Set<string>();
    for (const obj of poppedOutDraggedObjects) {
      const id = obj.id;
      if (remoteDragPositions[id] && !dragPositions[id]) {
        ids.add(id);
      }
    }
    return ids;
  }, [poppedOutDraggedObjects, remoteDragPositions, dragPositions]);

  // Get remote cursors (not current user)
  useEffect(() => {
    const liveIds = new Set(Object.keys(liveDragPositions));
    dragInsideFrameRef.current.forEach((id) => {
      if (!liveIds.has(id)) {
        dragInsideFrameRef.current.delete(id);
      }
    });
  }, [liveDragPositions]);

  // Remote cursors — extract raw positions then micro-interpolate
  const rawRemoteCursors = useMemo(() => {
    return Object.entries(users)
      .filter(([uid, p]) => uid !== currentUserId && p.online && p.cursor)
      .map(([uid, p]) => ({
        id: uid,
        displayName: p.displayName,
        color: p.cursorColor,
        x: p.cursor!.x,
        y: p.cursor!.y,
      }));
  }, [users, currentUserId]);

  // Smooth micro-interpolation: glides between 30ms broadcast hops,
  // adaptive duration so cursor arrives at target before next update.
  const remoteCursors = useCursorInterpolation(rawRemoteCursors);

  const getCanvasPoint = useCallback(
    (stage: Konva.Stage) => {
      const pointer = stage.getPointerPosition();
      if (!pointer) return null;
      return {
        x: (pointer.x - stage.x()) / stage.scaleX(),
        y: (pointer.y - stage.y()) / stage.scaleY(),
      };
    },
    []
  );

  const handleMouseMove = useCallback(
    (e: Konva.KonvaEventObject<MouseEvent>) => {
      const stage = e.target.getStage();
      if (!stage) return;
      const canvasPoint = getCanvasPoint(stage);
      if (!canvasPoint) return;

      onCursorMove(canvasPoint.x, canvasPoint.y);

      // Arrow drawing preview
      if (arrowDraw && activeTool === "arrow") {
        setArrowDraw((prev) =>
          prev ? { ...prev, toX: canvasPoint.x, toY: canvasPoint.y } : null
        );
      }

      // Line drawing preview
      if (lineDraw && activeTool === "line") {
        setLineDraw((prev) =>
          prev ? { ...prev, endX: canvasPoint.x, endY: canvasPoint.y } : null
        );
      }

      // Frame drawing preview
      if (frameDraw && activeTool === "frame") {
        setFrameDraw((prev) =>
          prev ? { ...prev, endX: canvasPoint.x, endY: canvasPoint.y } : null
        );
      }

      // Frame manual drag (from overlay header)
      if (frameManualDrag) {
        const { frameId, startMouseX, startMouseY, startFrameX, startFrameY } = frameManualDrag;
        const dx = canvasPoint.x - startMouseX;
        const dy = canvasPoint.y - startMouseY;
        const newX = startFrameX + dx;
        const newY = startFrameY + dy;

        const newPositions: Record<string, { x: number; y: number }> = {
          [frameId]: { x: newX, y: newY },
        };

        // Move contained objects with the frame
        const frameOffsets = frameContainedRef.current;
        for (const [cid, offset] of Object.entries(frameOffsets)) {
          newPositions[cid] = { x: newX + offset.dx, y: newY + offset.dy };
        }

        // Schedule a local visual update at display refresh rate (~60fps).
        const frameParentMap: Record<string, string | null> = { [frameId]: null };
        for (const cid of Object.keys(newPositions)) {
          if (cid !== frameId) frameParentMap[cid] = frameId;
        }
        scheduleDragStateUpdate(newPositions, frameParentMap);

        // Network broadcast remains throttled.
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
      }

      // Selection rect drag (skip during right-click pan)
      if (selectionStartRef.current && activeTool === "select" && !spaceHeldRef.current && !rightClickPanRef.current) {
        const start = selectionStartRef.current;
        setSelectionRect({
          x: start.x,
          y: start.y,
          width: canvasPoint.x - start.x,
          height: canvasPoint.y - start.y,
          visible: true,
        });
      }
    },
    [
      onCursorMove,
      getCanvasPoint,
      activeTool,
      arrowDraw,
      lineDraw,
      frameDraw,
      frameManualDrag,
      onObjectDragBroadcast,
      scheduleDragStateUpdate,
    ]
  );

  // DEFAULT_TITLE_HEIGHT, MIN/DEFAULT_FRAME_*, FRAME_CLICK_THRESHOLD,
  // FRAME_CONTENT_PADDING are declared at module level above to avoid temporal
  // dead zone errors when useMemo hooks reference them before this point.

  const getFrameAtPoint = useCallback((x: number, y: number): BoardObject | null => {
    const frames = Object.values(objectsRef.current)
      .filter((o) => o.type === "frame")
      .sort((a, b) => (b.zIndex || 0) - (a.zIndex || 0));

    for (const frame of frames) {
      const titleHeight = getFrameHeaderHeight(frame);
      const insideX = x >= frame.x && x <= frame.x + frame.width;
      const insideY = y >= frame.y + titleHeight && y <= frame.y + frame.height;
      if (insideX && insideY) return frame;
    }
    return null;
  }, []);

  const getObjectsInFrame = useCallback((frameId: string) => {
    return Object.values(objectsRef.current).filter((o) => o.parentFrameId === frameId && o.type !== "frame");
  }, []);

  const handleStageClick = useCallback(
    (e: Konva.KonvaEventObject<MouseEvent>) => {
      if (e.evt.button === 2) return; // Ignore right-click
      if (e.target !== e.target.getStage()) return;

      const stage = e.target.getStage();
      if (!stage) return;
      const canvasPoint = getCanvasPoint(stage);
      if (!canvasPoint) return;

      // Close text editing
      if (editingObjectId) {
        setEditingObjectId(null);
        onSetEditingObject(null);
        return;
      }

      if (activeTool === "select") {
        // Don't clear if we just finished a drag-selection
        if (justFinishedSelectionRef.current) {
          justFinishedSelectionRef.current = false;
          return;
        }
        onClearSelection();
        setSelectedConnectorIds(new Set());
        return;
      }

      if (activeTool === "arrow") {
        if (arrowDraw) setArrowDraw(null);
        return;
      }

      // Line tool: first click sets start, second click creates line
      if (activeTool === "line") {
        if (!lineDraw) {
          setLineDraw({
            startX: canvasPoint.x,
            startY: canvasPoint.y,
            endX: canvasPoint.x,
            endY: canvasPoint.y,
          });
        } else {
          const maxZ = Math.max(0, ...Object.values(objectsRef.current).map((o) => o.zIndex || 0));
          const x = Math.min(lineDraw.startX, canvasPoint.x);
          const y = Math.min(lineDraw.startY, canvasPoint.y);
          const width = Math.abs(canvasPoint.x - lineDraw.startX) || 1;
          const height = Math.abs(canvasPoint.y - lineDraw.startY) || 1;
          const parentFrame = getFrameAtPoint(x + width / 2, y + height / 2);
          const newId = onCreateObject({
            type: "line",
            x,
            y,
            width,
            height,
            color: activeColor,
            rotation: 0,
            zIndex: maxZ + 1,
            createdBy: currentUserId,
            parentFrameId: parentFrame?.id ?? null,
            points: [
              lineDraw.startX - x,
              lineDraw.startY - y,
              canvasPoint.x - x,
              canvasPoint.y - y,
            ],
            strokeWidth: 3,
          });
          setLineDraw(null);
          // Push undo after Firebase assigns the object
          setTimeout(() => {
            const created = objectsRef.current[newId];
            if (created) {
              onPushUndo({ type: "create_object", objectId: newId, object: created });
            }
          }, 100);
          onResetTool(newId);
        }
        return;
      }

      // Create object at click position
      const maxZIndex = Math.max(0, ...Object.values(objectsRef.current).map((o) => o.zIndex || 0));

      const createAndTrack = (obj: Omit<BoardObject, "id" | "createdAt" | "updatedAt">) => {
        const newId = onCreateObject(obj);
        // Track for undo after Firebase sync
        setTimeout(() => {
          const created = objectsRef.current[newId];
          if (created) {
            onPushUndo({ type: "create_object", objectId: newId, object: created });
          }
        }, 100);
        return newId;
      };

      if (activeTool === "sticky") {
        const x = canvasPoint.x - 75;
        const y = canvasPoint.y - 75;
        const width = 150;
        const height = 150;
        const parentFrame = getFrameAtPoint(x + width / 2, y + height / 2);
        const newId = createAndTrack({
          type: "sticky",
          x,
          y,
          width,
          height,
          color: activeColor,
          text: "",
          rotation: 0,
          zIndex: maxZIndex + 1,
          createdBy: currentUserId,
          parentFrameId: parentFrame?.id ?? null,
        });
        onResetTool(newId);
      } else if (activeTool === "rectangle") {
        const x = canvasPoint.x - 75;
        const y = canvasPoint.y - 50;
        const width = 150;
        const height = 100;
        const parentFrame = getFrameAtPoint(x + width / 2, y + height / 2);
        const newId = createAndTrack({
          type: "rectangle",
          x,
          y,
          width,
          height,
          color: activeColor,
          text: "",
          rotation: 0,
          zIndex: maxZIndex + 1,
          createdBy: currentUserId,
          parentFrameId: parentFrame?.id ?? null,
        });
        onResetTool(newId);
      } else if (activeTool === "circle") {
        const x = canvasPoint.x - 50;
        const y = canvasPoint.y - 50;
        const width = 100;
        const height = 100;
        const parentFrame = getFrameAtPoint(x + width / 2, y + height / 2);
        const newId = createAndTrack({
          type: "circle",
          x,
          y,
          width,
          height,
          color: activeColor,
          text: "",
          rotation: 0,
          zIndex: maxZIndex + 1,
          createdBy: currentUserId,
          parentFrameId: parentFrame?.id ?? null,
        });
        onResetTool(newId);
      }
    },
    [
      activeTool,
      activeColor,
      getCanvasPoint,
      currentUserId,
      editingObjectId,
      arrowDraw,
      lineDraw,
      onCreateObject,
      onClearSelection,
      onSetEditingObject,
      onResetTool,
      onPushUndo,
      getFrameAtPoint,
    ]
  );

  const dragStartPosRef = useRef<Record<string, { x: number; y: number }>>({});

  // Track start positions for all selected objects during group drag
  const groupDragOffsetsRef = useRef<Record<string, { dx: number; dy: number }>>({});
  // Track contained objects when a frame is being dragged
  const frameContainedRef = useRef<Record<string, { dx: number; dy: number }>>({});

  // Handle frame header manual drag start (called from FrameOverlay)
  // Called at the very start of a frame resize gesture — records the frame
  // and children positions so we can compute an undo batch on resize end.
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
  }, []);

  const handleFrameHeaderDragStart = useCallback((frameId: string) => {
    const frame = objectsRef.current[frameId];
    if (!frame) return;

    // We need to get the current mouse position on stage
    const stage = stageRef.current;
    if (!stage) return;

    const pointerPos = stage.getPointerPosition();
    if (!pointerPos) return;

    // Convert to canvas coordinates
    const canvasX = (pointerPos.x - viewport.x) / viewport.scale;
    const canvasY = (pointerPos.y - viewport.y) / viewport.scale;

    setFrameManualDrag({
      frameId,
      startMouseX: canvasX,
      startMouseY: canvasY,
      startFrameX: frame.x,
      startFrameY: frame.y,
    });

    // Record start positions for undo
    dragStartPosRef.current[frameId] = { x: frame.x, y: frame.y };

    // Also record contained objects for moving with the frame
    const frameOffsets: Record<string, { dx: number; dy: number }> = {};
    getObjectsInFrame(frameId).forEach((cobj) => {
      frameOffsets[cobj.id] = { dx: cobj.x - frame.x, dy: cobj.y - frame.y };
      dragStartPosRef.current[cobj.id] = { x: cobj.x, y: cobj.y };
    });
    frameContainedRef.current = frameOffsets;

  }, [viewport, stageRef, getObjectsInFrame]);

  const handleDragStart = useCallback((id: string) => {
    draggingRef.current.add(id);
    const obj = objectsRef.current[id];
    if (obj) {
      dragStartPosRef.current[id] = { x: obj.x, y: obj.y };
      if (obj.parentFrameId) dragInsideFrameRef.current.add(id);
    }

    // Collect children for ALL frames being dragged (primary + selected).
    // This handles multi-frame selection correctly.
    const frameOffsets: Record<string, { dx: number; dy: number }> = {};
    const collectFrameChildren = (frameId: string, _frameObj: BoardObject) => {
      getObjectsInFrame(frameId).forEach((cobj) => {
        // Don't override if already tracked (e.g. object selected directly)
        if (!frameOffsets[cobj.id]) {
          frameOffsets[cobj.id] = { dx: cobj.x - obj!.x, dy: cobj.y - obj!.y };
          dragStartPosRef.current[cobj.id] = { x: cobj.x, y: cobj.y };
        }
      });
    };

    // If primary object is a frame, collect its children
    if (obj && obj.type === "frame") {
      collectFrameChildren(obj.id, obj);
    }

    // If this object is part of a multi-selection, record offsets for group drag
    if (selectedIds.has(id) && selectedIds.size > 1) {
      const offsets: Record<string, { dx: number; dy: number }> = {};
      selectedIds.forEach((sid) => {
        if (sid !== id) {
          const sobj = objectsRef.current[sid];
          if (sobj && obj) {
            offsets[sid] = { dx: sobj.x - obj.x, dy: sobj.y - obj.y };
            dragStartPosRef.current[sid] = { x: sobj.x, y: sobj.y };
            // If this selected object is also a frame, collect its children too
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
  }, [selectedIds, getObjectsInFrame]);

  const handleDragMove = useCallback(
    (id: string, x: number, y: number) => {
      const stage = stageRef.current;
      const draggedObj = objectsRef.current[id];
      let primaryX = x;
      let primaryY = y;
      let primaryParentFrameId: string | null | undefined = draggedObj?.parentFrameId ?? null;

      // Prevent non-frame objects from sliding under frames while cursor is outside.
      const isGroupDrag = selectedIds.has(id) && selectedIds.size > 1;
      if (draggedObj && draggedObj.type !== "frame" && !isGroupDrag) {
        const pointer = stage?.getPointerPosition();
        let frameUnderCursorId: string | null = null;
        if (pointer && stage) {
          const cx = (pointer.x - stage.x()) / stage.scaleX();
          const cy = (pointer.y - stage.y()) / stage.scaleY();
          frameUnderCursorId = getFrameAtPoint(cx, cy)?.id ?? null;
        }

        // Determine which frame this object is allowed to overlap with.
        // Start with the frame under the cursor, then apply hysteresis.
        let allowedFrameId = frameUnderCursorId;

        // For objects already in a frame (parentFrameId set): check pop-out
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

        // For uncontained objects: check overlap directly to decide
        // whether to allow entering/staying in a frame.
        // This runs in the handler (before render memos) so the ref
        // is set in time for the constraint below.
        if (!allowedFrameId && !currentParentFrameId) {
          const allFrames = Object.values(objectsRef.current)
            .filter((o) => o.type === "frame")
            .sort((a, b) => (b.zIndex || 0) - (a.zIndex || 0));
          const wasInside = dragInsideFrameRef.current.has(id);
          const threshold = wasInside ? 0.45 : 0.55;

          for (const frame of allFrames) {
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

        const frames = Object.values(objectsRef.current).filter((o) => o.type === "frame");
        const constrained = constrainObjectOutsideFrames(
          { x: primaryX, y: primaryY, width: draggedObj.width, height: draggedObj.height },
          frames,
          allowedFrameId
        );
        primaryX = constrained.x;
        primaryY = constrained.y;

        if (stage) {
          setNodeTopLeft(id, primaryX, primaryY);
          const node = stage.findOne(`#node-${id}`);
          if (node) {
            // Hide original node when entering preview is showing (avoid double render)
            node.opacity(allowedFrameId && !currentParentFrameId ? 0 : 1);
          }
        }
      }

      // No DB writes during drag — only on drag end.
      // This avoids setObjects re-renders that kill local FPS.

      // Build live positions for all dragged items (for connector re-render)
      const positions: Record<string, { x: number; y: number }> = {
        [id]: { x: primaryX, y: primaryY },
      };
      const parentFrameMap: Record<string, string | null> = {
        [id]: primaryParentFrameId ?? (draggedObj?.parentFrameId ?? null),
      };

      // Move frame-contained objects (children of ALL selected frames)
      const frameOffsets = frameContainedRef.current;
      for (const [cid, offset] of Object.entries(frameOffsets)) {
        const newX = primaryX + offset.dx;
        const newY = primaryY + offset.dy;
        positions[cid] = { x: newX, y: newY };
        // Preserve the child's actual parent frame ID (may differ from primary drag target)
        parentFrameMap[cid] = objectsRef.current[cid]?.parentFrameId ?? null;
        // Move Konva node directly for instant visual feedback (no DB write during drag)
        if (stage) setNodeTopLeft(cid, newX, newY);
      }

      // Move other selected objects in the group
      const offsets = groupDragOffsetsRef.current;
      for (const [sid, offset] of Object.entries(offsets)) {
        const newX = primaryX + offset.dx;
        const newY = primaryY + offset.dy;
        positions[sid] = { x: newX, y: newY };
        parentFrameMap[sid] = objectsRef.current[sid]?.parentFrameId ?? null;
        // Move Konva node directly for instant visual feedback (no DB write during drag)
        if (stage) setNodeTopLeft(sid, newX, newY);
      }

      // Schedule a local visual update at display refresh rate (~60fps).
      scheduleDragStateUpdate(positions, parentFrameMap);

      // Throttled broadcast for collaborators (~50ms intervals)
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
      onCursorMove,
      onObjectDragBroadcast,
      selectedIds,
      getFrameAtPoint,
      scheduleDragStateUpdate,
    ]
  );

  const handleDragEnd = useCallback(
    (id: string, x: number, y: number) => {
      draggingRef.current.delete(id);

      // Restore opacity on the original node (may have been hidden during entering preview)
      const stageNode = stageRef.current;
      if (stageNode) {
        const node = stageNode.findOne(`#node-${id}`);
        if (node) node.opacity(1);
      }

      // Commit primary dragged object
      const startPos = dragStartPosRef.current[id];
      const draggedObj = objectsRef.current[id];

      const livePos = dragPositions[id];
      let finalX = livePos?.x ?? x;
      let finalY = livePos?.y ?? y;
      let finalParentFrameId: string | null | undefined = draggedObj?.parentFrameId ?? null;

      // For non-frame objects:
      // - membership follows cursor position on drop
      // - if cursor is outside frames, snap object fully outside frame bounds
      if (draggedObj && draggedObj.type !== "frame") {
        const stage = stageRef.current;
        const pointer = stage?.getPointerPosition();

        let targetFrame: BoardObject | null = null;
        if (pointer && stage) {
          const cx = (pointer.x - stage.x()) / stage.scaleX();
          const cy = (pointer.y - stage.y()) / stage.scaleY();
          targetFrame = getFrameAtPoint(cx, cy);
        }

        // Fallback if no pointer available
        if (!targetFrame) {
          const centerX = finalX + draggedObj.width / 2;
          const centerY = finalY + draggedObj.height / 2;
          targetFrame = getFrameAtPoint(centerX, centerY);
        }

        finalParentFrameId = targetFrame?.id ?? null;

        const frames = Object.values(objectsRef.current).filter((o) => o.type === "frame");
        const constrained = constrainObjectOutsideFrames(
          { x: finalX, y: finalY, width: draggedObj.width, height: draggedObj.height },
          frames,
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

      // Commit frame-contained objects (children of ALL selected frames)
      const frameOffsets = frameContainedRef.current;
      for (const [cid, offset] of Object.entries(frameOffsets)) {
        const newX = finalX + offset.dx;
        const newY = finalY + offset.dy;
        finalPositions[cid] = { x: newX, y: newY };
        // Preserve each child's actual parent frame ID
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

      // Cancel any pending rAF flush before writing final state so a
      // stale scheduled frame doesn't overwrite the committed positions.
      if (rafIdRef.current !== null) {
        cancelAnimationFrame(rafIdRef.current);
        rafIdRef.current = null;
      }
      pendingDragPositionsRef.current = null;
      pendingDragParentFrameIdsRef.current = null;

      // Keep final live positions briefly to avoid release flicker.
      setDragPositions(finalPositions);
      setDragParentFrameIds(finalParentFrameMap);

      // Broadcast final positions, then end-drag marker for collaborators.
      for (const movedId of Object.keys(finalPositions)) {
        const pos = finalPositions[movedId];
        onObjectDragBroadcast(movedId, pos.x, pos.y, finalParentFrameMap[movedId] ?? null);
        onObjectDragEndBroadcast(movedId);
      }

      groupDragOffsetsRef.current = {};
      lastDragBroadcastRef.current = {};   // stop heartbeat
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
      onUpdateObject,
      onPushUndo,
      onObjectDragBroadcast,
      onObjectDragEndBroadcast,
      getFrameAtPoint,
      dragPositions,
      stageRef,
      clearDragPositionsSoon,
    ]
  );

  const handleConnectorSelect = useCallback(
    (id: string) => {
      // Clear object selection, select this connector
      onClearSelection();
      setSelectedConnectorIds(new Set([id]));
    },
    [onClearSelection]
  );

  // ─── Helpers for center-offset nodes ────────────────────────
  // Shapes and stickies use Konva offset (center pivot for rotation).
  // Their Konva x/y = topLeft + width/2.  Frames/lines use top-left.
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
    []
  );

  // ─── Rotation ───────────────────────────────────────────────
  const rotateStartRef = useRef<{ id: string; rotation: number } | null>(null);

  const handleRotateStart = useCallback((id: string) => {
    const obj = objectsRef.current[id];
    if (!obj) return;
    rotateStartRef.current = { id, rotation: obj.rotation || 0 };
    onRotatingChange?.(true);
  }, [onRotatingChange]);

  const handleRotateMove = useCallback(
    (id: string, angle: number) => {
      // Normalise to [0, 360)
      const norm = ((angle % 360) + 360) % 360;
      onUpdateObject(id, { rotation: norm });
    },
    [onUpdateObject]
  );

  const handleRotateEnd = useCallback(
    (id: string, _angle: number) => {
      const obj = objectsRef.current[id];
      if (!obj) return;
      const start = rotateStartRef.current;
      if (start && start.id === id) {
        onPushUndo({
          type: "update_object",
          objectId: id,
          before: { rotation: start.rotation },
          after: { rotation: obj.rotation },
        });
      }
      rotateStartRef.current = null;
      onRotatingChange?.(false);
    },
    [onPushUndo, onRotatingChange]
  );

  const handleDoubleClick = useCallback(
    (id: string) => {
      if (activeTool === "arrow") return;
      const lock = isObjectLocked(id);
      if (lock.locked) return;
      setEditingObjectId(id);
      onSetEditingObject(id);
    },
    [isObjectLocked, onSetEditingObject, activeTool]
  );

  // Arrow tool: click on object to start, click on another to connect
  const handleObjectClickForArrow = useCallback(
    (id: string) => {
      if (activeTool !== "arrow") return;

      const obj = objectsRef.current[id];
      if (!obj) return;

      const centerX = obj.x + obj.width / 2;
      const centerY = obj.y + obj.height / 2;

      if (!arrowDraw) {
        setArrowDraw({
          fromId: id,
          fromX: centerX,
          fromY: centerY,
          toX: centerX,
          toY: centerY,
        });
      } else {
        if (arrowDraw.fromId !== id) {
          onCreateConnector({
            fromId: arrowDraw.fromId,
            toId: id,
            style: "arrow",
          });
          onResetTool();
        }
        setArrowDraw(null);
      }
    },
    [activeTool, arrowDraw, onCreateConnector, onResetTool]
  );

  const handleObjectClick = useCallback(
    (id: string, multi?: boolean) => {
      if (activeTool === "arrow") {
        handleObjectClickForArrow(id);
      } else {
        onSelect(id, multi);
        // After selection changes, update connector selection:
        // Select connectors where both ends are in the (new) selection
        // We need to compute what the new selectedIds will be
        const newSelected = new Set(selectedIds);
        if (multi) {
          if (newSelected.has(id)) newSelected.delete(id);
          else newSelected.add(id);
        } else {
          newSelected.clear();
          newSelected.add(id);
        }
        const connIds = Object.values(connectorsRef.current)
          .filter((c) => newSelected.has(c.fromId) && newSelected.has(c.toId))
          .map((c) => c.id);
        setSelectedConnectorIds(new Set(connIds));
      }
    },
    [activeTool, handleObjectClickForArrow, onSelect, selectedIds]
  );

  const handleTextCommit = useCallback(
    (id: string, text: string) => {
      onUpdateObject(id, { text });
      onDraftTextChange(id, "");
      setEditingObjectId(null);
      onSetEditingObject(null);
    },
    [onUpdateObject, onSetEditingObject, onDraftTextChange]
  );

  const handleTextCancel = useCallback(() => {
    if (editingObjectId) {
      onDraftTextChange(editingObjectId, "");
    }
    setEditingObjectId(null);
    onSetEditingObject(null);
  }, [onSetEditingObject, onDraftTextChange, editingObjectId]);

  const handleMouseDown = useCallback(
    (e: Konva.KonvaEventObject<MouseEvent>) => {
      if (e.evt.button === 2) return; // Ignore right-click (used for panning)
      if (e.target !== e.target.getStage()) return;
      if (spaceHeldRef.current) return; // Don't start selection while panning

      const stage = e.target.getStage();
      if (!stage) return;
      const canvasPoint = getCanvasPoint(stage);
      if (!canvasPoint) return;

      if (activeTool === "frame") {
        setFrameDraw({
          startX: canvasPoint.x,
          startY: canvasPoint.y,
          endX: canvasPoint.x,
          endY: canvasPoint.y,
        });
        return;
      }

      if (activeTool === "arrow" && arrowDraw) {
        setArrowDraw(null);
        return;
      }

      if (activeTool !== "select") return;

      selectionStartRef.current = canvasPoint;
    },
    [activeTool, getCanvasPoint, arrowDraw]
  );

  const handleMouseUp = useCallback(() => {
    if (activeTool === "frame" && frameDraw) {
      const frameRect = computeFrameFromGesture({
        startX: frameDraw.startX,
        startY: frameDraw.startY,
        endX: frameDraw.endX,
        endY: frameDraw.endY,
        clickThreshold: FRAME_CLICK_THRESHOLD,
        defaultWidth: DEFAULT_FRAME_WIDTH,
        defaultHeight: DEFAULT_FRAME_HEIGHT,
        minWidth: MIN_FRAME_WIDTH,
        minHeight: MIN_FRAME_HEIGHT,
      });

      const minZIndex = Math.min(0, ...Object.values(objectsRef.current).map((o) => o.zIndex || 0));
      const newId = onCreateObject({
        type: "frame",
        x: frameRect.x,
        y: frameRect.y,
        width: frameRect.width,
        height: frameRect.height,
        color: "#F8FAFC",
        text: "Frame",
        rotation: 0,
        zIndex: minZIndex - 1,
        createdBy: currentUserId,
      });

      setTimeout(() => {
        const created = objectsRef.current[newId];
        if (created) {
          onPushUndo({ type: "create_object", objectId: newId, object: created });
        }
      }, 100);

      setFrameDraw(null);
      onResetTool(newId);
      return;
    }

    if (selectionRect.visible) {
      const rect = {
        x: Math.min(selectionRect.x, selectionRect.x + selectionRect.width),
        y: Math.min(selectionRect.y, selectionRect.y + selectionRect.height),
        width: Math.abs(selectionRect.width),
        height: Math.abs(selectionRect.height),
      };

      // Only process if drag was meaningful (> 5px)
      if (rect.width > 5 && rect.height > 5) {
        // Select objects that overlap the selection rectangle
        const selectedObjIds = getObjectIdsInRect(objectsRef.current, rect);

        // Select connectors whose line segment intersects the selection rectangle
        // This allows selecting arrows by dragging over just the arrow, not its endpoints
        const selectedConnIds = getConnectorIdsInRect(connectorsRef.current, objectsRef.current, rect);

        if (selectedObjIds.length > 0 || selectedConnIds.length > 0) {
          onClearSelection();
          selectedObjIds.forEach((id) => onSelect(id, true));
          setSelectedConnectorIds(new Set(selectedConnIds));
          justFinishedSelectionRef.current = true;
        } else {
          justFinishedSelectionRef.current = true;
        }
      }
    }

    selectionStartRef.current = null;
    setSelectionRect((prev) => ({ ...prev, visible: false }));

    // Commit frame manual drag
    if (frameManualDrag) {
      const { frameId } = frameManualDrag;
      const draggedPos = dragPositions[frameId];
      if (draggedPos) {
        // Commit frame position
        onUpdateObject(frameId, { x: draggedPos.x, y: draggedPos.y });

        // Commit contained objects positions
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

        // Push undo action
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

      // Clear drag state
      lastDragBroadcastRef.current = {};   // stop heartbeat
      setFrameManualDrag(null);
      clearDragPositionsSoon();
      frameContainedRef.current = {};
      dragStartPosRef.current = {};
      dragInsideFrameRef.current.clear();
    }
  }, [
    activeTool,
    frameDraw,
    currentUserId,
    selectionRect,
    onCreateObject,
    onResetTool,
    onSelect,
    onClearSelection,
    frameManualDrag,
    dragPositions,
    onUpdateObject,
    onPushUndo,
    onObjectDragBroadcast,
    onObjectDragEndBroadcast,
    clearDragPositionsSoon,
  ]);

  // Handle keyboard delete + escape
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement
      ) {
        return;
      }
      if (e.key === "Backspace" || e.key === "Delete") {
        if (editingObjectId) return;
        const batchActions: UndoAction[] = [];
        const deletedIds = new Set<string>();
        selectedIds.forEach((id) => {
          const obj = objectsRef.current[id];
          if (!obj || deletedIds.has(id)) return;

          if (obj.type === "frame") {
            // Record children for undo, then delete frame + children atomically.
            const childIds = new Set<string>();
            Object.values(objectsRef.current)
              .filter((o) => o.parentFrameId === obj.id)
              .forEach((cobj) => {
                if (!deletedIds.has(cobj.id)) {
                  batchActions.push({ type: "delete_object", objectId: cobj.id, object: { ...cobj } });
                  deletedIds.add(cobj.id);
                  childIds.add(cobj.id);
                }
              });

            batchActions.push({ type: "delete_object", objectId: id, object: { ...obj } });
            deletedIds.add(id);

            // Record connectors attached to the frame or its children for undo.
            // The DB cascade (ON DELETE CASCADE on from_id/to_id) removes these
            // automatically, so they must be in the undo batch for restore.
            const allDeletedObjectIds = new Set([id, ...childIds]);
            Object.values(connectorsRef.current).forEach((conn) => {
              if (allDeletedObjectIds.has(conn.fromId) || allDeletedObjectIds.has(conn.toId)) {
                batchActions.push({ type: "delete_connector", connectorId: conn.id, connector: { ...conn } });
              }
            });

            onDeleteFrame(id);
            return;
          }

          batchActions.push({ type: "delete_object", objectId: id, object: { ...obj } });
          onDeleteObject(id);
          deletedIds.add(id);
        });
        selectedConnectorIds.forEach((id) => {
          const conn = connectorsRef.current[id];
          if (conn) batchActions.push({ type: "delete_connector", connectorId: id, connector: { ...conn } });
          onDeleteConnector(id);
        });
        if (batchActions.length > 0) {
          onPushUndo(batchActions.length === 1 ? batchActions[0] : { type: "batch", actions: batchActions });
        }
        onClearSelection();
        setSelectedConnectorIds(new Set());
      }
      if (e.key === "Escape") {
        setArrowDraw(null);
        setLineDraw(null);
        setFrameDraw(null);
        if (editingObjectId) {
          setEditingObjectId(null);
          onSetEditingObject(null);
        }
        onClearSelection();
        setSelectedConnectorIds(new Set());
        // Return to select tool
        onResetTool();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [selectedIds, selectedConnectorIds, editingObjectId, onDeleteObject, onDeleteFrame, onDeleteConnector, onClearSelection, onSetEditingObject, onPushUndo]);

  const handleStageDragEnd = useCallback(
    (e: Konva.KonvaEventObject<DragEvent>) => {
      if (e.target !== e.target.getStage()) return;
      setViewport((prev) => ({
        ...prev,
        x: e.target.x(),
        y: e.target.y(),
      }));
    },
    [setViewport]
  );

  const editingObject = editingObjectId ? objects[editingObjectId] : null;

  // Cursor style
  const cursorStyle = isPanning
    ? "grab"
    : activeTool === "arrow" || activeTool === "line"
    ? "crosshair"
    : activeTool === "select"
    ? "default"
    : "crosshair";

  // Viewport culling: compute visible bounds in canvas coordinates
  // and skip rendering objects that are entirely off-screen.
  const CULL_MARGIN = 200; // Extra margin (canvas px) to avoid pop-in during pan
  const visibleBounds = useMemo(() => {
    const invScale = 1 / viewport.scale;
    return {
      left: -viewport.x * invScale - CULL_MARGIN,
      top: -viewport.y * invScale - CULL_MARGIN,
      right: (-viewport.x + stageWidth) * invScale + CULL_MARGIN,
      bottom: (-viewport.y + stageHeight) * invScale + CULL_MARGIN,
    };
  }, [viewport.x, viewport.y, viewport.scale, stageWidth, stageHeight]);

  const isInViewport = useCallback(
    (obj: BoardObject): boolean => {
      return (
        obj.x + obj.width >= visibleBounds.left &&
        obj.x <= visibleBounds.right &&
        obj.y + obj.height >= visibleBounds.top &&
        obj.y <= visibleBounds.bottom
      );
    },
    [visibleBounds]
  );

  // Apply viewport culling to partitioned lists.
  // Objects currently being dragged are always rendered regardless of viewport.
  const visibleShapes = useMemo(
    () => partitionedObjects.uncontainedShapes.filter(
      (obj) => draggingRef.current.has(obj.id) || isInViewport(obj)
    ),
    [partitionedObjects.uncontainedShapes, isInViewport]
  );
  const visibleStickies = useMemo(
    () => partitionedObjects.uncontainedStickies.filter(
      (obj) => draggingRef.current.has(obj.id) || isInViewport(obj)
    ),
    [partitionedObjects.uncontainedStickies, isInViewport]
  );
  const visibleFrames = useMemo(
    () => partitionedObjects.frames.filter(
      (obj) => draggingRef.current.has(obj.id) || isInViewport(obj)
    ),
    [partitionedObjects.frames, isInViewport]
  );
  const visibleLines = useMemo(
    () => partitionedObjects.lines.filter(
      (obj) => draggingRef.current.has(obj.id) || isInViewport(obj)
    ),
    [partitionedObjects.lines, isInViewport]
  );

  return (
    <div
      className="relative w-full h-full overflow-hidden bg-gray-50"
      style={{ cursor: cursorStyle }}
    >
      {/* Grid background */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          backgroundImage: [
            // Minor dots
            "radial-gradient(circle, rgba(100,116,139,0.42) 1.15px, transparent 1.3px)",
            // Major dots every 5 cells for easier spatial scanning
            "radial-gradient(circle, rgba(71,85,105,0.55) 1.4px, transparent 1.55px)",
          ].join(","),
          backgroundSize: `${Math.max(10, 20 * viewport.scale)}px ${Math.max(10, 20 * viewport.scale)}px, ${Math.max(50, 100 * viewport.scale)}px ${Math.max(50, 100 * viewport.scale)}px`,
          backgroundPosition: `${viewport.x}px ${viewport.y}px, ${viewport.x}px ${viewport.y}px`,
          opacity: 0.72,
        }}
      />

      {/* Line tool hint */}
      {activeTool === "line" && (
        <div className="fixed bottom-16 left-1/2 -translate-x-1/2 z-50 bg-gray-800 text-white text-sm px-4 py-2 rounded-lg shadow-lg pointer-events-none">
          {lineDraw
            ? "Click to place the line's end point — Esc to cancel"
            : "Click to place the line's start point"}
        </div>
      )}

      {/* Frame tool hint */}
      {activeTool === "frame" && (
        <div className="fixed bottom-16 left-1/2 -translate-x-1/2 z-50 bg-gray-800 text-white text-sm px-4 py-2 rounded-lg shadow-lg pointer-events-none">
          {frameDraw
            ? "Release to place frame — drag for custom size, click for default"
            : "Click for a default frame, or click-drag to size it"}
        </div>
      )}

      {/* Arrow tool hint */}
      {activeTool === "arrow" && (
        <div className="fixed bottom-16 left-1/2 -translate-x-1/2 z-50 bg-gray-800 text-white text-sm px-4 py-2 rounded-lg shadow-lg pointer-events-none">
          {arrowDraw
            ? "Click on another object to connect — Esc to cancel"
            : "Click on an object to start an arrow"}
        </div>
      )}

      {/* Pan hint */}
      {isPanning && (
        <div className="fixed bottom-16 left-1/2 -translate-x-1/2 z-50 bg-gray-800 text-white text-sm px-4 py-2 rounded-lg shadow-lg pointer-events-none">
          Panning — release Space to stop
        </div>
      )}

      <Stage
        ref={stageRef}
        width={stageWidth}
        height={stageHeight}
        x={viewport.x}
        y={viewport.y}
        scaleX={viewport.scale}
        scaleY={viewport.scale}
        draggable={isPanning}
        onWheel={onWheel}
        onClick={handleStageClick}
        onTap={handleStageClick as any}
        onMouseMove={handleMouseMove}
        onMouseDown={handleMouseDown}
        onMouseUp={handleMouseUp}
        onDragEnd={handleStageDragEnd}
      >
        {/* Objects layer */}
        <Layer>
          {/* Intra-frame connectors are rendered inside each frame's clipped group below */}

          {/* Arrow drawing preview */}
          {arrowDraw && (
            <Arrow
              points={[arrowDraw.fromX, arrowDraw.fromY, arrowDraw.toX, arrowDraw.toY]}
              stroke="#6B7280"
              strokeWidth={2}
              fill="#6B7280"
              pointerLength={12}
              pointerWidth={9}
              dash={[6, 4]}
              listening={false}
            />
          )}

          {/* Line drawing preview */}
          {lineDraw && (
            <Line
              points={[lineDraw.startX, lineDraw.startY, lineDraw.endX, lineDraw.endY]}
              stroke={activeColor}
              strokeWidth={3}
              dash={[6, 4]}
              lineCap="round"
              listening={false}
            />
          )}

          {/* Frame drawing preview */}
          {frameDraw && (
            <Rect
              x={Math.min(frameDraw.startX, frameDraw.endX)}
              y={Math.min(frameDraw.startY, frameDraw.endY)}
              width={Math.max(MIN_FRAME_WIDTH, Math.abs(frameDraw.endX - frameDraw.startX))}
              height={Math.max(MIN_FRAME_HEIGHT, Math.abs(frameDraw.endY - frameDraw.startY))}
              fill="rgba(248, 250, 252, 0.6)"
              stroke="#94A3B8"
              strokeWidth={2}
              dash={[8, 4]}
              cornerRadius={8}
              listening={false}
            />
          )}

          {/* Render uncontained objects first (so frame body can sit on top) */}
          {visibleShapes
            .filter((obj) => !remoteEnteringDraggedObjectIds.has(obj.id))
            .map((obj) => {
              const lock = isObjectLocked(obj.id);
              return (
                <Shape
                  key={obj.id}
                  object={withLivePosition(objects[obj.id] || obj)}
                  isSelected={selectedIds.has(obj.id)}
                  isEditing={editingObjectId === obj.id}
                  isLockedByOther={lock.locked}
                  lockedByColor={lock.lockedByColor}
                  draftText={getDraftTextForObject(obj.id)?.text}
                  onSelect={handleObjectClick}
                  onDragStart={handleDragStart}
                  onDragMove={handleDragMove}
                  onDragEnd={handleDragEnd}
                  onDoubleClick={handleDoubleClick}
                  onUpdateObject={onUpdateObject}
                  onRotateStart={handleRotateStart}
                  onRotateMove={handleRotateMove}
                  onRotateEnd={handleRotateEnd}
                />
              );
            })}

          {visibleStickies
            .filter((obj) => !remoteEnteringDraggedObjectIds.has(obj.id))
            .map((obj) => {
              const lock = isObjectLocked(obj.id);
              return (
                <StickyNote
                  key={obj.id}
                  object={withLivePosition(objects[obj.id] || obj)}
                  isSelected={selectedIds.has(obj.id)}
                  isEditing={editingObjectId === obj.id}
                  isLockedByOther={lock.locked}
                  lockedByName={lock.lockedBy}
                  lockedByColor={lock.lockedByColor}
                  draftText={getDraftTextForObject(obj.id)?.text}
                  onSelect={handleObjectClick}
                  onDragStart={handleDragStart}
                  onDragMove={handleDragMove}
                  onDragEnd={handleDragEnd}
                  onDoubleClick={handleDoubleClick}
                  onUpdateObject={onUpdateObject}
                  onRotateStart={handleRotateStart}
                  onRotateMove={handleRotateMove}
                  onRotateEnd={handleRotateEnd}
                />
              );
            })}

          {/* Render frame backgrounds + clipped contained objects */}
          {visibleFrames.map((obj) => {
              const frameObj = withLivePosition(objects[obj.id] || obj);
              const contained = (objectsByFrame[frameObj.id] || []).filter(
                (cobj) => !remotePoppedOutDraggedObjectIds.has(cobj.id)
              );
              const entering = enteringFrameDraggedObjects
                .filter((entry) => entry.frameId === frameObj.id)
                .map((entry) => entry.object);
              const enteringIds = new Set(entering.map((o) => o.id));
              const clippedObjects = [...contained, ...entering]
                .filter((o) => o.type !== "line")
                .sort((a, b) => (a.zIndex || 0) - (b.zIndex || 0));
              const framePos =
                resolvedLiveDragPositions[frameObj.id] || { x: frameObj.x, y: frameObj.y };
              const frameHeaderHeight = getFrameHeaderHeight(frameObj);

              return (
                <React.Fragment key={obj.id}>
                  {/* Frame background */}
                  <Frame
                    object={frameObj}
                    isSelected={selectedIds.has(obj.id)}
                    isEditing={editingObjectId === obj.id}
                    containedCount={contained.length}
                    isSelectMode={activeTool === "select"}
                    onDragStart={handleDragStart}
                    onDragMove={handleDragMove}
                    onDragEnd={handleDragEnd}
                  />

                  {/* Clipped contained objects + connectors + entering previews */}
                  {(clippedObjects.length > 0 || (connectorsByFrame[frameObj.id]?.length ?? 0) > 0) && (
                    <Group
                      clipFunc={(ctx) => {
                        ctx.rect(
                          framePos.x,
                          framePos.y + frameHeaderHeight,
                          frameObj.width,
                          frameObj.height - frameHeaderHeight
                        );
                      }}
                    >
                      {clippedObjects.map((cobj) => {
                        const lock = isObjectLocked(cobj.id);
                        const isEnteringPreview = enteringIds.has(cobj.id);
                        const liveObj = resolvedLiveDragPositions[cobj.id]
                          ? { ...cobj, ...resolvedLiveDragPositions[cobj.id] }
                          : cobj;

                        const rendered =
                          cobj.type === "line" ? (
                            <LineObject
                              key={cobj.id}
                              object={liveObj}
                              isSelected={selectedIds.has(cobj.id)}
                              onSelect={handleObjectClick}
                              onDragStart={handleDragStart}
                              onDragMove={handleDragMove}
                              onDragEnd={handleDragEnd}
                              onUpdateObject={onUpdateObject}
                            />
                          ) : cobj.type === "rectangle" || cobj.type === "circle" ? (
                            <Shape
                              key={cobj.id}
                              object={liveObj}
                              isSelected={selectedIds.has(cobj.id)}
                              isEditing={editingObjectId === cobj.id}
                              isLockedByOther={lock.locked}
                              lockedByColor={lock.lockedByColor}
                              draftText={getDraftTextForObject(cobj.id)?.text}
                              onSelect={handleObjectClick}
                              onDragStart={handleDragStart}
                              onDragMove={handleDragMove}
                              onDragEnd={handleDragEnd}
                              onDoubleClick={handleDoubleClick}
                              onUpdateObject={onUpdateObject}
                              onRotateStart={handleRotateStart}
                              onRotateMove={handleRotateMove}
                              onRotateEnd={handleRotateEnd}
                            />
                          ) : cobj.type === "sticky" ? (
                            <StickyNote
                              key={cobj.id}
                              object={liveObj}
                              isSelected={selectedIds.has(cobj.id)}
                              isEditing={editingObjectId === cobj.id}
                              isLockedByOther={lock.locked}
                              lockedByName={lock.lockedBy}
                              lockedByColor={lock.lockedByColor}
                              draftText={getDraftTextForObject(cobj.id)?.text}
                              onSelect={handleObjectClick}
                              onDragStart={handleDragStart}
                              onDragMove={handleDragMove}
                              onDragEnd={handleDragEnd}
                              onDoubleClick={handleDoubleClick}
                              onUpdateObject={onUpdateObject}
                              onRotateStart={handleRotateStart}
                              onRotateMove={handleRotateMove}
                              onRotateEnd={handleRotateEnd}
                            />
                          ) : null;

                        if (!rendered) return null;
                        return isEnteringPreview ? (
                          <Group key={`entering-${cobj.id}`} listening={false}>
                            {rendered}
                          </Group>
                        ) : (
                          rendered
                        );
                      })}

                      {/* Intra-frame connectors (both endpoints in this frame and neither being dragged out) */}
                      {(connectorsByFrame[frameObj.id] || [])
                        .filter((conn) =>
                          !poppedOutDraggedObjectIds.has(conn.fromId) && !poppedOutDraggedObjectIds.has(conn.toId)
                        )
                        .map((conn) => {
                          const from = objectsWithLivePositions[conn.fromId];
                          const to = objectsWithLivePositions[conn.toId];
                          if (!from || !to) return null;
                          return (
                            <ConnectorLine
                              key={conn.id}
                              connector={conn}
                              fromObj={from}
                              toObj={to}
                              isSelected={selectedConnectorIds.has(conn.id)}
                              onSelect={handleConnectorSelect}
                            />
                          );
                        })}
                    </Group>
                  )}
                </React.Fragment>
              );
            })}


          {/* Live pop-out previews for dragged objects leaving frames */}
          {poppedOutDraggedObjects.map((obj) => {
            const lock = isObjectLocked(obj.id);
            return (
              <Group key={`popout-${obj.id}`} listening={false}>
                {obj.type === "line" ? (
                  <LineObject
                    object={obj}
                    isSelected={selectedIds.has(obj.id)}
                    onSelect={handleObjectClick}
                    onDragStart={handleDragStart}
                    onDragMove={handleDragMove}
                    onDragEnd={handleDragEnd}
                    onUpdateObject={onUpdateObject}
                  />
                ) : obj.type === "rectangle" || obj.type === "circle" ? (
                  <Shape
                    object={obj}
                    isSelected={selectedIds.has(obj.id)}
                    isEditing={editingObjectId === obj.id}
                    isLockedByOther={lock.locked}
                    lockedByColor={lock.lockedByColor}
                    draftText={getDraftTextForObject(obj.id)?.text}
                    onSelect={handleObjectClick}
                    onDragStart={handleDragStart}
                    onDragMove={handleDragMove}
                    onDragEnd={handleDragEnd}
                    onDoubleClick={handleDoubleClick}
                    onUpdateObject={onUpdateObject}
                    onRotateStart={handleRotateStart}
                    onRotateMove={handleRotateMove}
                    onRotateEnd={handleRotateEnd}
                  />
                ) : obj.type === "sticky" ? (
                  <StickyNote
                    object={obj}
                    isSelected={selectedIds.has(obj.id)}
                    isEditing={editingObjectId === obj.id}
                    isLockedByOther={lock.locked}
                    lockedByName={lock.lockedBy}
                    lockedByColor={lock.lockedByColor}
                    draftText={getDraftTextForObject(obj.id)?.text}
                    onSelect={handleObjectClick}
                    onDragStart={handleDragStart}
                    onDragMove={handleDragMove}
                    onDragEnd={handleDragEnd}
                    onDoubleClick={handleDoubleClick}
                    onUpdateObject={onUpdateObject}
                    onRotateStart={handleRotateStart}
                    onRotateMove={handleRotateMove}
                    onRotateEnd={handleRotateEnd}
                  />
                ) : null}
              </Group>
            );
          })}

          {/* Frame overlays (header + border on top) */}
          {visibleFrames.map((obj) => {
              const frameObj = withLivePosition(objects[obj.id] || obj);
              const framePos =
                resolvedLiveDragPositions[frameObj.id] || { x: frameObj.x, y: frameObj.y };
              const contained = objectsByFrame[frameObj.id] || [];
              const fMinSizes = frameMinSizes[obj.id];
              return (
                <FrameOverlay
                  key={`overlay-${obj.id}`}
                  object={{ ...frameObj, x: framePos.x, y: framePos.y }}
                  isSelected={selectedIds.has(obj.id)}
                  isEditing={editingObjectId === obj.id}
                  containedCount={contained.length}
                  isSelectMode={activeTool === "select"}
                  onSelect={handleObjectClick}
                  onDoubleClick={handleDoubleClick}
                  onDragStart={handleFrameHeaderDragStart}
                  onUpdateObject={onUpdateObject}
                  onFrameResizeStart={handleFrameResizeStart}
                  minFrameWidth={fMinSizes?.minWidth}
                  minFrameHeight={fMinSizes?.minHeight}
                  onResizePreview={(objectId, updates) => {
                    const existing = objectsRef.current[objectId];
                    if (!existing) return;
                    const x = updates.x ?? existing.x;
                    const y = updates.y ?? existing.y;
                    const width = updates.width ?? existing.width;
                    const height = updates.height ?? existing.height;

                    // Push contained children inward so they stay inside the
                    // new frame bounds.
                    const children = Object.values(objectsRef.current).filter(
                      (o) => o.parentFrameId === objectId && o.type !== "frame"
                    );
                    const titleHeight = getFrameHeaderHeight({
                      ...existing,
                      width,
                    });

                    const childUpdates = constrainChildrenInFrame(
                      { x, y, width, height },
                      children,
                      titleHeight,
                      FRAME_CONTENT_PADDING
                    );
                    for (const [childId, pos] of Object.entries(childUpdates)) {
                      onUpdateObject(childId, pos);
                      onObjectDragBroadcast(childId, pos.x, pos.y, objectId);
                      // Track which children were moved for undo.
                      if (frameResizeTrackRef.current?.frameId === objectId) {
                        frameResizeTrackRef.current.movedChildIds.add(childId);
                      }
                    }

                    // Broadcast frame resize to collaborators.
                    onObjectDragBroadcast(
                      objectId,
                      x,
                      y,
                      existing.parentFrameId ?? null,
                      width,
                      height
                    );
                  }}
                  onResizePreviewEnd={(objectId) => {
                    // Build undo batch from tracked start → current state.
                    const track = frameResizeTrackRef.current;
                    if (track && track.frameId === objectId) {
                      const finalFrame = objectsRef.current[objectId];
                      const batchActions: UndoAction[] = [];

                      // Frame bounds change
                      if (finalFrame) {
                        const sf = track.startFrame;
                        if (
                          sf.x !== finalFrame.x ||
                          sf.y !== finalFrame.y ||
                          sf.width !== finalFrame.width ||
                          sf.height !== finalFrame.height
                        ) {
                          batchActions.push({
                            type: "update_object",
                            objectId,
                            before: { x: sf.x, y: sf.y, width: sf.width, height: sf.height },
                            after: {
                              x: finalFrame.x,
                              y: finalFrame.y,
                              width: finalFrame.width,
                              height: finalFrame.height,
                            },
                          });
                        }
                      }

                      // Child position changes
                      for (const childId of track.movedChildIds) {
                        const startPos = track.startChildren[childId];
                        const finalChild = objectsRef.current[childId];
                        if (startPos && finalChild && (startPos.x !== finalChild.x || startPos.y !== finalChild.y)) {
                          batchActions.push({
                            type: "update_object",
                            objectId: childId,
                            before: { x: startPos.x, y: startPos.y },
                            after: { x: finalChild.x, y: finalChild.y },
                          });
                        }
                        // End collaborator drag preview for this child.
                        onObjectDragEndBroadcast(childId);
                      }

                      if (batchActions.length > 0) {
                        onPushUndo(
                          batchActions.length === 1
                            ? batchActions[0]
                            : { type: "batch", actions: batchActions }
                        );
                      }

                      frameResizeTrackRef.current = null;
                    }

                    // End collaborator drag preview for the frame.
                    onObjectDragEndBroadcast(objectId);
                  }}
                />
              );
            })}

          {/* Top-level connectors: cross-frame, unframed, or with a popped-out endpoint */}
          {Object.values(connectors)
            .filter((conn) => {
              const from = objects[conn.fromId];
              const to = objects[conn.toId];
              const fromFrame = from?.parentFrameId ?? null;
              const toFrame = to?.parentFrameId ?? null;
              // If either endpoint is being dragged out of its frame, render unclipped
              if (poppedOutDraggedObjectIds.has(conn.fromId) || poppedOutDraggedObjectIds.has(conn.toId)) return true;
              // Anything NOT intra-frame renders on top of frames
              return !(fromFrame != null && fromFrame === toFrame);
            })
            .map((conn) => {
              const fromObj = objectsWithLivePositions[conn.fromId];
              const toObj = objectsWithLivePositions[conn.toId];
              if (!fromObj || !toObj) return null;
              return (
                <ConnectorLine
                  key={`top-${conn.id}`}
                  connector={conn}
                  fromObj={fromObj}
                  toObj={toObj}
                  isSelected={selectedConnectorIds.has(conn.id)}
                  onSelect={handleConnectorSelect}
                />
              );
            })}

          {/* All lines render on top (never clipped, like connectors) */}
          {visibleLines.map((obj) => (
              <LineObject
                key={obj.id}
                object={withLivePosition(objects[obj.id] || obj)}
                isSelected={selectedIds.has(obj.id)}
                onSelect={handleObjectClick}
                onDragStart={handleDragStart}
                onDragMove={handleDragMove}
                onDragEnd={handleDragEnd}
                onUpdateObject={onUpdateObject}
              />
            ))}

          {/* Selection rectangle */}
          <SelectionRect {...selectionRect} />
        </Layer>

        {/* Cursors layer (separate for performance) */}
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
      </Stage>

      {/* Text editing overlay */}
      {editingObject && (
        <TextOverlay
          object={editingObject}
          stageX={viewport.x}
          stageY={viewport.y}
          scale={viewport.scale}
          onCommit={handleTextCommit}
          onCancel={handleTextCancel}
          onDraftChange={(text) => onDraftTextChange(editingObject.id, text)}
        />
      )}
    </div>
  );
}
