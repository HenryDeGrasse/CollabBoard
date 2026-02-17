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
import { throttle } from "../../utils/throttle";
import { getObjectIdsInRect, getConnectorIdsInRect } from "../../utils/selection";
import {
  constrainObjectOutsideFrames,
  shouldPopOutFromFrame,
} from "../../utils/frame-containment";

export type ToolType = "select" | "sticky" | "rectangle" | "circle" | "arrow" | "line" | "frame";

interface BoardProps {
  objects: Record<string, BoardObject>;
  connectors: Record<string, Connector>;
  users: Record<string, UserPresence>;
  currentUserId: string;
  canvas: UseCanvasReturn;
  selectedIds: Set<string>;
  activeTool: ToolType;
  activeColor: string;
  onSelect: (id: string, multi?: boolean) => void;
  onClearSelection: () => void;
  onCreateObject: (obj: Omit<BoardObject, "id" | "createdAt" | "updatedAt">) => string;
  onUpdateObject: (id: string, updates: Partial<BoardObject>) => void;
  onDeleteObject: (id: string) => void;
  onCreateConnector: (conn: Omit<Connector, "id">) => string;
  onDeleteConnector: (id: string) => void;
  onCursorMove: (x: number, y: number) => void;
  onSetEditingObject: (objectId: string | null) => void;
  onDraftTextChange: (text: string) => void;
  getDraftTextForObject: (objectId: string) => { text: string; userName: string } | null;
  isObjectLocked: (objectId: string) => { locked: boolean; lockedBy?: string; lockedByColor?: string };
  onResetTool: (selectId?: string) => void;
  onPushUndo: (action: UndoAction) => void;
}

export function Board({
  objects,
  connectors,
  users,
  currentUserId,
  canvas,
  selectedIds,
  activeTool,
  activeColor,
  onSelect,
  onClearSelection,
  onCreateObject,
  onUpdateObject,
  onDeleteObject,
  onCreateConnector,
  onDeleteConnector,
  onCursorMove,
  onSetEditingObject,
  onDraftTextChange,
  getDraftTextForObject,
  isObjectLocked,
  onResetTool,
  onPushUndo,
}: BoardProps) {
  const { viewport, setViewport, onWheel, stageRef } = canvas;
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

  // Live position overrides during drag — triggers re-render so connectors update
  const [dragPositions, setDragPositions] = useState<Record<string, { x: number; y: number }>>({});

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

  // Throttled drag sync for remote updates
  const throttledDragUpdate = useMemo(
    () =>
      throttle((id: string, x: number, y: number) => {
        onUpdateObject(id, { x, y });
      }, 80),
    [onUpdateObject]
  );

  // Sort objects by zIndex for rendering order
  const sortedObjects = useMemo(
    () =>
      Object.values(objects).sort((a, b) => (a.zIndex || 0) - (b.zIndex || 0)),
    [objects]
  );

  const poppedOutDraggedObjects = useMemo(() => {
    return Object.values(objects)
      .filter((obj) => !!obj.parentFrameId && !!dragPositions[obj.id])
      .map((obj) => {
        const live = dragPositions[obj.id]!;
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
  }, [objects, dragPositions]);

  // While dragging uncontained objects into a frame, show a live in-frame preview.
  // Hysteresis: entering uses higher threshold (0.55), staying in uses lower (0.45).
  const enteringFrameDraggedObjects = useMemo(() => {
    const frames = Object.values(objects)
      .filter((o) => o.type === "frame")
      .sort((a, b) => (b.zIndex || 0) - (a.zIndex || 0));

    return Object.values(objects)
      .filter((obj) => !obj.parentFrameId && !!dragPositions[obj.id] && obj.type !== "frame")
      .map((obj) => {
        const live = dragPositions[obj.id]!;
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
  }, [objects, dragPositions]);

  const enteringDraggedIds = useMemo(
    () => new Set(enteringFrameDraggedObjects.map((entry) => entry.object.id)),
    [enteringFrameDraggedObjects]
  );

  // Get remote cursors (not current user)
  const remoteCursors = useMemo(() => {
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

        // Update frame position in dragPositions
        setDragPositions((prev) => ({
          ...prev,
          [frameId]: { x: newX, y: newY },
        }));

        // Move contained objects with the frame
        const frameOffsets = frameContainedRef.current;
        const newPositions: Record<string, { x: number; y: number }> = {};
        for (const [cid, offset] of Object.entries(frameOffsets)) {
          newPositions[cid] = { x: newX + offset.dx, y: newY + offset.dy };
        }
        setDragPositions((prev) => ({ ...prev, ...newPositions }));
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
    [onCursorMove, getCanvasPoint, activeTool, arrowDraw, frameManualDrag]
  );

  const TITLE_HEIGHT = 32;
  const MIN_FRAME_WIDTH = 200;
  const MIN_FRAME_HEIGHT = 150;

  const getFrameAtPoint = useCallback((x: number, y: number): BoardObject | null => {
    const frames = Object.values(objects)
      .filter((o) => o.type === "frame")
      .sort((a, b) => (b.zIndex || 0) - (a.zIndex || 0));

    for (const frame of frames) {
      const insideX = x >= frame.x && x <= frame.x + frame.width;
      const insideY = y >= frame.y + TITLE_HEIGHT && y <= frame.y + frame.height;
      if (insideX && insideY) return frame;
    }
    return null;
  }, [objects]);

  const getObjectsInFrame = useCallback((frameId: string) => {
    return Object.values(objects).filter((o) => o.parentFrameId === frameId && o.type !== "frame");
  }, [objects]);

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
          const maxZ = Math.max(0, ...Object.values(objects).map((o) => o.zIndex || 0));
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
            const created = objects[newId];
            if (created) {
              onPushUndo({ type: "create_object", objectId: newId, object: created });
            }
          }, 100);
          onResetTool(newId);
        }
        return;
      }

      // Create object at click position
      const maxZIndex = Math.max(0, ...Object.values(objects).map((o) => o.zIndex || 0));

      const createAndTrack = (obj: Omit<BoardObject, "id" | "createdAt" | "updatedAt">) => {
        const newId = onCreateObject(obj);
        // Track for undo after Firebase sync
        setTimeout(() => {
          const created = objects[newId];
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
      } else if (activeTool === "frame") {
        if (!frameDraw) {
          // First click: start drawing
          setFrameDraw({
            startX: canvasPoint.x,
            startY: canvasPoint.y,
            endX: canvasPoint.x,
            endY: canvasPoint.y,
          });
        } else {
          // Second click: create the frame
          const x = Math.min(frameDraw.startX, canvasPoint.x);
          const y = Math.min(frameDraw.startY, canvasPoint.y);
          const width = Math.max(MIN_FRAME_WIDTH, Math.abs(canvasPoint.x - frameDraw.startX));
          const height = Math.max(MIN_FRAME_HEIGHT, Math.abs(canvasPoint.y - frameDraw.startY));
          const minZIndex = Math.min(0, ...Object.values(objects).map((o) => o.zIndex || 0));
          const newId = createAndTrack({
            type: "frame",
            x,
            y,
            width,
            height,
            color: "#F8FAFC",
            text: "Frame",
            rotation: 0,
            zIndex: minZIndex - 1,
            createdBy: currentUserId,
          });
          setFrameDraw(null);
          onResetTool(newId);
        }
      }
    },
    [
      activeTool,
      activeColor,
      getCanvasPoint,
      objects,
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
      frameDraw,
    ]
  );

  const dragStartPosRef = useRef<Record<string, { x: number; y: number }>>({});

  // Track start positions for all selected objects during group drag
  const groupDragOffsetsRef = useRef<Record<string, { dx: number; dy: number }>>({});
  // Track contained objects when a frame is being dragged
  const frameContainedRef = useRef<Record<string, { dx: number; dy: number }>>({});

  // Handle frame header manual drag start (called from FrameOverlay)
  const handleFrameHeaderDragStart = useCallback((frameId: string) => {
    const frame = objects[frameId];
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

  }, [objects, viewport, stageRef, getObjectsInFrame]);

  const handleDragStart = useCallback((id: string) => {
    draggingRef.current.add(id);
    const obj = objects[id];
    if (obj) {
      dragStartPosRef.current[id] = { x: obj.x, y: obj.y };
      if (obj.parentFrameId) dragInsideFrameRef.current.add(id);
    }

    // If this is a frame, also move explicitly-contained objects
    if (obj && obj.type === "frame") {
      const frameOffsets: Record<string, { dx: number; dy: number }> = {};
      getObjectsInFrame(obj.id).forEach((cobj) => {
        frameOffsets[cobj.id] = { dx: cobj.x - obj.x, dy: cobj.y - obj.y };
        dragStartPosRef.current[cobj.id] = { x: cobj.x, y: cobj.y };
      });
      frameContainedRef.current = frameOffsets;
    } else {
      frameContainedRef.current = {};
    }

    // If this object is part of a multi-selection, record offsets for group drag
    if (selectedIds.has(id) && selectedIds.size > 1) {
      const offsets: Record<string, { dx: number; dy: number }> = {};
      selectedIds.forEach((sid) => {
        if (sid !== id) {
          const sobj = objects[sid];
          if (sobj && obj) {
            offsets[sid] = { dx: sobj.x - obj.x, dy: sobj.y - obj.y };
            dragStartPosRef.current[sid] = { x: sobj.x, y: sobj.y };
          }
        }
      });
      groupDragOffsetsRef.current = offsets;
    } else {
      groupDragOffsetsRef.current = {};
    }
  }, [objects, selectedIds, getObjectsInFrame]);

  const handleDragMove = useCallback(
    (id: string, x: number, y: number) => {
      const stage = stageRef.current;
      const draggedObj = objects[id];
      let primaryX = x;
      let primaryY = y;

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
          const currentParentFrame = objects[currentParentFrameId];
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

        // For uncontained objects entering a frame: if hysteresis says
        // we're inside, allow overlap even if cursor drifts slightly outside
        if (!allowedFrameId && !currentParentFrameId && dragInsideFrameRef.current.has(id)) {
          // Find which frame the hysteresis thinks we're in
          const frames = Object.values(objects)
            .filter((o) => o.type === "frame")
            .sort((a, b) => (b.zIndex || 0) - (a.zIndex || 0));
          for (const frame of frames) {
            const stillInside = !shouldPopOutFromFrame(
              { x: primaryX, y: primaryY, width: draggedObj.width, height: draggedObj.height },
              { x: frame.x, y: frame.y, width: frame.width, height: frame.height },
              0.45
            );
            if (stillInside) {
              allowedFrameId = frame.id;
              break;
            }
          }
          // If no frame qualifies at exit threshold, object has left
          if (!allowedFrameId) {
            dragInsideFrameRef.current.delete(id);
          }
        }

        const frames = Object.values(objects).filter((o) => o.type === "frame");
        const constrained = constrainObjectOutsideFrames(
          { x: primaryX, y: primaryY, width: draggedObj.width, height: draggedObj.height },
          frames,
          allowedFrameId
        );
        primaryX = constrained.x;
        primaryY = constrained.y;

        if (stage) {
          const node = stage.findOne(`#node-${id}`);
          if (node) {
            node.x(primaryX);
            node.y(primaryY);
          }
        }
      }

      throttledDragUpdate(id, primaryX, primaryY);

      // Build live positions for all dragged items (for connector re-render)
      const positions: Record<string, { x: number; y: number }> = {
        [id]: { x: primaryX, y: primaryY },
      };

      // Move frame-contained objects
      const frameOffsets = frameContainedRef.current;
      for (const [cid, offset] of Object.entries(frameOffsets)) {
        const newX = primaryX + offset.dx;
        const newY = primaryY + offset.dy;
        positions[cid] = { x: newX, y: newY };
        throttledDragUpdate(cid, newX, newY);
        if (stage) {
          const node = stage.findOne(`#node-${cid}`);
          if (node) {
            node.x(newX);
            node.y(newY);
          }
        }
      }

      // Move other selected objects in the group
      const offsets = groupDragOffsetsRef.current;
      for (const [sid, offset] of Object.entries(offsets)) {
        const newX = primaryX + offset.dx;
        const newY = primaryY + offset.dy;
        positions[sid] = { x: newX, y: newY };
        throttledDragUpdate(sid, newX, newY);
        // Move Konva node directly for instant visual feedback
        if (stage) {
          const node = stage.findOne(`#node-${sid}`);
          if (node) {
            node.x(newX);
            node.y(newY);
          }
        }
      }

      // Update live drag positions so connectors re-render
      setDragPositions(positions);

      // Broadcast cursor position during drag
      if (stage) {
        const pointer = stage.getPointerPosition();
        if (pointer) {
          const cx = (pointer.x - stage.x()) / stage.scaleX();
          const cy = (pointer.y - stage.y()) / stage.scaleY();
          onCursorMove(cx, cy);
        }
      }
    },
    [throttledDragUpdate, stageRef, onCursorMove, objects, selectedIds, getFrameAtPoint]
  );

  const handleDragEnd = useCallback(
    (id: string, x: number, y: number) => {
      draggingRef.current.delete(id);

      // Commit primary dragged object
      const startPos = dragStartPosRef.current[id];
      const draggedObj = objects[id];

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

        const frames = Object.values(objects).filter((o) => o.type === "frame");
        const constrained = constrainObjectOutsideFrames(
          { x: finalX, y: finalY, width: draggedObj.width, height: draggedObj.height },
          frames,
          finalParentFrameId ?? null
        );
        finalX = constrained.x;
        finalY = constrained.y;
      }

      onUpdateObject(id, { x: finalX, y: finalY, parentFrameId: finalParentFrameId ?? null });

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
      groupDragOffsetsRef.current = {};
      setDragPositions({});
      dragInsideFrameRef.current.clear();

      if (batchUndoActions.length > 0) {
        onPushUndo(
          batchUndoActions.length === 1
            ? batchUndoActions[0]
            : { type: "batch", actions: batchUndoActions }
        );
      }
    },
    [onUpdateObject, onPushUndo, objects, getFrameAtPoint, dragPositions, stageRef]
  );

  const handleConnectorSelect = useCallback(
    (id: string) => {
      // Clear object selection, select this connector
      onClearSelection();
      setSelectedConnectorIds(new Set([id]));
    },
    [onClearSelection]
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

      const obj = objects[id];
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
    [activeTool, arrowDraw, objects, onCreateConnector, onResetTool]
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
        const connIds = Object.values(connectors)
          .filter((c) => newSelected.has(c.fromId) && newSelected.has(c.toId))
          .map((c) => c.id);
        setSelectedConnectorIds(new Set(connIds));
      }
    },
    [activeTool, handleObjectClickForArrow, onSelect, selectedIds, connectors]
  );

  const handleTextCommit = useCallback(
    (id: string, text: string) => {
      onUpdateObject(id, { text });
      setEditingObjectId(null);
      onSetEditingObject(null);
    },
    [onUpdateObject, onSetEditingObject]
  );

  const handleTextCancel = useCallback(() => {
    setEditingObjectId(null);
    onSetEditingObject(null);
  }, [onSetEditingObject]);

  const handleMouseDown = useCallback(
    (e: Konva.KonvaEventObject<MouseEvent>) => {
      if (e.evt.button === 2) return; // Ignore right-click (used for panning)
      if (e.target !== e.target.getStage()) return;
      if (spaceHeldRef.current) return; // Don't start selection while panning

      if (activeTool === "arrow" && arrowDraw) {
        setArrowDraw(null);
        return;
      }

      if (activeTool !== "select") return;

      const stage = e.target.getStage();
      if (!stage) return;
      const canvasPoint = getCanvasPoint(stage);
      if (!canvasPoint) return;

      selectionStartRef.current = canvasPoint;
    },
    [activeTool, getCanvasPoint, arrowDraw]
  );

  const handleMouseUp = useCallback(() => {
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
        const selectedObjIds = getObjectIdsInRect(objects, rect);

        // Select connectors whose line segment intersects the selection rectangle
        // This allows selecting arrows by dragging over just the arrow, not its endpoints
        const selectedConnIds = getConnectorIdsInRect(connectors, objects, rect);

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
          }
        }

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
      setFrameManualDrag(null);
      setDragPositions({});
      frameContainedRef.current = {};
      dragStartPosRef.current = {};
      dragInsideFrameRef.current.clear();
    }
  }, [selectionRect, objects, connectors, onSelect, onClearSelection, frameManualDrag, dragPositions, onUpdateObject, onPushUndo]);

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
          const obj = objects[id];
          if (!obj || deletedIds.has(id)) return;

          // If deleting a frame, also delete objects explicitly in that frame
          if (obj.type === "frame") {
            Object.values(objects)
              .filter((o) => o.parentFrameId === obj.id)
              .forEach((cobj) => {
                if (!deletedIds.has(cobj.id)) {
                  batchActions.push({ type: "delete_object", objectId: cobj.id, object: { ...cobj } });
                  onDeleteObject(cobj.id);
                  deletedIds.add(cobj.id);
                }
              });
          }

          batchActions.push({ type: "delete_object", objectId: id, object: { ...obj } });
          onDeleteObject(id);
          deletedIds.add(id);
        });
        selectedConnectorIds.forEach((id) => {
          const conn = connectors[id];
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
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [selectedIds, selectedConnectorIds, editingObjectId, objects, connectors, onDeleteObject, onDeleteConnector, onClearSelection, onSetEditingObject, onPushUndo]);

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

  return (
    <div
      className="relative w-full h-full overflow-hidden bg-gray-50"
      style={{ cursor: cursorStyle }}
    >
      {/* Grid background */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          backgroundImage: `radial-gradient(circle, #d1d5db 1px, transparent 1px)`,
          backgroundSize: `${20 * viewport.scale}px ${20 * viewport.scale}px`,
          backgroundPosition: `${viewport.x}px ${viewport.y}px`,
          opacity: 0.5,
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
            ? "Click to place the opposite corner — Esc to cancel"
            : "Click to place one corner of the frame"}
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
          {/* Render connectors first (below objects) */}
          {Object.values(connectors).map((conn) => (
            <ConnectorLine
              key={conn.id}
              connector={conn}
              objects={objects}
              isSelected={selectedConnectorIds.has(conn.id)}
              onSelect={handleConnectorSelect}
              positionOverrides={dragPositions}
            />
          ))}

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
          {sortedObjects
            .filter((obj) => obj.type === "line" && !obj.parentFrameId && !enteringDraggedIds.has(obj.id))
            .map((obj) => (
              <LineObject
                key={obj.id}
                object={objects[obj.id] || obj}
                isSelected={selectedIds.has(obj.id)}
                onSelect={handleObjectClick}
                onDragStart={handleDragStart}
                onDragMove={handleDragMove}
                onDragEnd={handleDragEnd}
                onUpdateObject={onUpdateObject}
              />
            ))}

          {sortedObjects
            .filter((obj) => ["rectangle", "circle"].includes(obj.type) && !obj.parentFrameId && !enteringDraggedIds.has(obj.id))
            .map((obj) => {
              const lock = isObjectLocked(obj.id);
              return (
                <Shape
                  key={obj.id}
                  object={objects[obj.id] || obj}
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
                />
              );
            })}

          {sortedObjects
            .filter((obj) => obj.type === "sticky" && !obj.parentFrameId && !enteringDraggedIds.has(obj.id))
            .map((obj) => {
              const lock = isObjectLocked(obj.id);
              return (
                <StickyNote
                  key={obj.id}
                  object={objects[obj.id] || obj}
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
                />
              );
            })}

          {/* Render frame backgrounds + clipped contained objects */}
          {sortedObjects
            .filter((obj) => obj.type === "frame")
            .map((obj) => {
              const frameObj = objects[obj.id] || obj;
              const contained = getObjectsInFrame(frameObj.id);
              const entering = enteringFrameDraggedObjects
                .filter((entry) => entry.frameId === frameObj.id)
                .map((entry) => entry.object);
              const enteringIds = new Set(entering.map((o) => o.id));
              const clippedObjects = [...contained, ...entering].sort(
                (a, b) => (a.zIndex || 0) - (b.zIndex || 0)
              );
              const framePos = dragPositions[frameObj.id] || { x: frameObj.x, y: frameObj.y };

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

                  {/* Clipped contained objects + entering previews */}
                  {clippedObjects.length > 0 && (
                    <Group
                      clipFunc={(ctx) => {
                        ctx.rect(
                          framePos.x,
                          framePos.y + TITLE_HEIGHT,
                          frameObj.width,
                          frameObj.height - TITLE_HEIGHT
                        );
                      }}
                    >
                      {clippedObjects.map((cobj) => {
                        const lock = isObjectLocked(cobj.id);
                        const isEnteringPreview = enteringIds.has(cobj.id);
                        const liveObj = dragPositions[cobj.id]
                          ? { ...cobj, ...dragPositions[cobj.id] }
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
                  />
                ) : null}
              </Group>
            );
          })}

          {/* Frame overlays (header + border on top) */}
          {sortedObjects
            .filter((obj) => obj.type === "frame")
            .map((obj) => {
              const frameObj = objects[obj.id] || obj;
              const framePos = dragPositions[frameObj.id] || { x: frameObj.x, y: frameObj.y };
              const contained = getObjectsInFrame(frameObj.id);
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
                />
              );
            })}

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
          onDraftChange={onDraftTextChange}
        />
      )}
    </div>
  );
}
