import React, { useState, useCallback, useMemo, useRef, useEffect } from "react";
import { Stage, Layer, Group } from "react-konva";
import Konva from "konva";
import { Frame, FrameOverlay } from "./Frame";
import { ConnectorLine } from "./Connector";
import { RemoteCursorsLayer } from "./RemoteCursorsLayer";
import { SelectionRect } from "./SelectionRect";
import { TextOverlay } from "./TextOverlay";
import { BoardObjectRenderer } from "./BoardObjectRenderer";
import { DrawingPreviews } from "./DrawingPreviews";
import { ToolHints } from "./ToolHints";
import { GridBackground } from "./GridBackground";
import { TopLevelConnectors } from "./TopLevelConnectors";
import type { BoardObject, Connector } from "../../types/board";
import type { ToolType } from "../../types/tool";
import type { UndoAction } from "../../hooks/useUndoRedo";
import type { RemoteUser } from "../../hooks/presence/usePresence";
import type { UseCanvasReturn } from "../../hooks/useCanvas";
import type { CursorStore } from "../../hooks/presence/usePresence";
import { useObjectPartitioning } from "../../hooks/canvas/useObjectPartitioning";
import { useViewportCulling } from "../../hooks/canvas/useViewportCulling";
import { useLivePositions } from "../../hooks/canvas/useLivePositions";
import { useDragSystem } from "../../hooks/canvas/useDragSystem";
import { useConnectorDraw } from "../../hooks/canvas/useConnectorDraw";
import { useDrawingTools } from "../../hooks/canvas/useDrawingTools";
import { useFrameInteraction } from "../../hooks/canvas/useFrameInteraction";
import { useInputHandling } from "../../hooks/canvas/useInputHandling";

import { getObjectIdsInRect, getConnectorIdsInRect } from "../../utils/selection";
import { constrainChildrenInFrame } from "../../utils/frame";
import { getFrameHeaderHeight } from "../../utils/text";

const FRAME_CONTENT_PADDING = 6;

interface BoardProps {
  objects: Record<string, BoardObject>;
  connectors: Record<string, Connector>;
  users: Record<string, RemoteUser>;
  cursorStore: CursorStore;
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
  activeStrokeWidth: number;
  onSelect: (id: string, multi?: boolean) => void;
  onClearSelection: () => void;
  onCreateObject: (obj: Omit<BoardObject, "id" | "createdAt" | "updatedAt">) => string;
  onUpdateObject: (id: string, updates: Partial<BoardObject>) => void;
  onDeleteObject: (id: string) => void;
  onDeleteFrame: (frameId: string) => void;
  onCreateConnector: (conn: Omit<Connector, "id">) => string;
  onUpdateConnector: (id: string, updates: Partial<Pick<Connector, "color" | "strokeWidth">>) => void;
  onDeleteConnector: (id: string) => void;
  /** Called when the set of selected connector IDs changes */
  onSelectedConnectorsChange?: (ids: Set<string>) => void;
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

export const Board = React.memo(function Board({
  objects,
  connectors,
  users,
  cursorStore,
  currentUserId,
  canvas,
  selectedIds,
  remoteDragPositions,
  activeTool,
  activeColor,
  activeStrokeWidth,
  onSelect,
  onClearSelection,
  onCreateObject,
  onUpdateObject,
  onDeleteObject,
  onDeleteFrame,
  onCreateConnector,
  onUpdateConnector: _onUpdateConnector,
  onDeleteConnector,
  onSelectedConnectorsChange,
  onCursorMove,
  onObjectDragBroadcast,
  onObjectDragEndBroadcast,
  onSetEditingObject,
  onDraftTextChange,
  getDraftTextForObject: _getDraftTextForObject,
  isObjectLocked,
  onResetTool,
  onPushUndo,
  onRotatingChange,
}: BoardProps) {
  const { viewport, setViewport, isZooming, onWheel, stageRef } = canvas;

  // Ref for the main objects layer — used to cache/uncache during zoom/pan.
  const objectsLayerRef = useRef<Konva.Layer | null>(null);

  // Stable ref for objects — used inside callbacks to avoid regenerating them
  // on every objects change. The ref is updated synchronously on every render,
  // so it is always current when any callback fires.
  const objectsRef = useRef(objects);
  objectsRef.current = objects;
  const connectorsRef = useRef(connectors);
  connectorsRef.current = connectors;
  const selectedIdsRef = useRef(selectedIds);
  selectedIdsRef.current = selectedIds;
  const [editingObjectId, setEditingObjectId] = useState<string | null>(null);
  const [selectedConnectorIds, _setSelectedConnectorIds] = useState<Set<string>>(new Set());
  const setSelectedConnectorIds = useCallback((ids: Set<string>) => {
    _setSelectedConnectorIds(ids);
    onSelectedConnectorsChange?.(ids);
  }, [onSelectedConnectorsChange]);
  // Track which objects are currently "inside a frame" during drag, for hysteresis
  // Shared between useDragSystem and useLivePositions
  const dragInsideFrameRef = useRef<Set<string>>(new Set());
  // Shared ref: useDragSystem heartbeat checks if frame manual drag is active
  const frameManualDragActiveRef = useRef(false);

  const isConnectorTool = activeTool === "arrow" || activeTool === "line";

  // Object partitioning: sorted objects, frame maps, min sizes, type partitions
  const {
    objectsByFrame,
    connectorsByFrame,
    frameMinSizes,
    partitionedObjects,
  } = useObjectPartitioning(objects, connectors);

  // Stable frame + children indexes for hot drag-path lookups.
  // Built once per objects change so getFrameAtPoint/getObjectsInFrame avoid
  // repeated Object.values/filter/sort work on every pointer move.
  const frameHitOrderRef = useRef<BoardObject[]>([]);
  const frameChildrenRef = useRef<Record<string, BoardObject[]>>({});
  useEffect(() => {
    const frames: BoardObject[] = [];
    const childrenByFrame: Record<string, BoardObject[]> = {};

    for (const obj of Object.values(objects)) {
      if (obj.type === "frame") {
        frames.push(obj);
      } else if (obj.parentFrameId) {
        if (!childrenByFrame[obj.parentFrameId]) {
          childrenByFrame[obj.parentFrameId] = [];
        }
        childrenByFrame[obj.parentFrameId].push(obj);
      }
    }

    frames.sort((a, b) => {
      const dz = (b.zIndex || 0) - (a.zIndex || 0);
      return dz !== 0 ? dz : b.id < a.id ? -1 : b.id > a.id ? 1 : 0;
    });
    frameHitOrderRef.current = frames;
    frameChildrenRef.current = childrenByFrame;
  }, [objects]);

  // When a remote collaborator starts dragging an object, imperatively promote
  // that Konva node to the top of the layer so it doesn't disappear under
  // higher-zIndex objects during the drag. The local drag path already calls
  // node.moveToTop() inside handleDragStart in useDragSystem; this covers the
  // remote case. React's re-render after the drag-end DB write (with the new
  // zIndex) restores the correct persistent order for all clients.
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    for (const id of Object.keys(remoteDragPositions)) {
      const node = stage.findOne(`#node-${id}`);
      if (node) node.moveToTop();
    }
  }, [remoteDragPositions, stageRef]);

  const getFrameAtPoint = useCallback((x: number, y: number): BoardObject | null => {
    const frames = frameHitOrderRef.current;

    for (const frame of frames) {
      const titleHeight = getFrameHeaderHeight(frame);
      const insideX = x >= frame.x && x <= frame.x + frame.width;
      const insideY = y >= frame.y + titleHeight && y <= frame.y + frame.height;
      if (insideX && insideY) return frame;
    }
    return null;
  }, []);

  const getObjectsInFrame = useCallback((frameId: string) => {
    return frameChildrenRef.current[frameId] || [];
  }, []);

  // Drag system: positions, rAF batching, broadcast, handlers
  const {
    dragPositions,
    dragParentFrameIds,
    draggingRef,
    frameContainedRef,
    dragStartPosRef,
    lastBroadcastRef,
    lastDragBroadcastRef,
    BROADCAST_INTERVAL,
    clearDragPositionsSoon,
    scheduleDragStateUpdate,
    handleDragStart,
    handleDragMove,
    handleDragEnd,
  } = useDragSystem({
    objectsRef,
    selectedIds,
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
  });

  // Connector drawing: hover detection, click-click creation workflow
  const {
    connectorDraw,
    connectorHoverObjectId,
    onMouseMove: connectorDrawMouseMove,
    onStageClick: connectorDrawStageClick,
    handleObjectClickForConnector,
    cancel: connectorDrawCancel,
  } = useConnectorDraw(
    activeTool, activeColor, activeStrokeWidth, objectsRef,
    onCreateConnector, onResetTool
  );

  // Shape/frame drawing: drag-to-create
  const {
    frameDraw,
    shapeDraw,
    onMouseMove: drawingToolsMouseMove,
    onMouseDown: drawingToolsMouseDown,
    onMouseUp: drawingToolsMouseUp,
    cancel: drawingToolsCancel,
  } = useDrawingTools(
    activeTool, activeColor, currentUserId, objectsRef,
    onCreateObject, onPushUndo, onResetTool, getFrameAtPoint
  );

  // Frame interaction: header drag, resize tracking
  const {
    frameResizeTrackRef,
    handleFrameResizeStart,
    handleFrameHeaderDragStart,
    onMouseMove: frameInteractionMouseMove,
    onMouseUp: frameInteractionMouseUp,
  } = useFrameInteraction(
    viewport, stageRef, objectsRef, dragPositions,
    frameContainedRef, dragStartPosRef,
    lastBroadcastRef, lastDragBroadcastRef, BROADCAST_INTERVAL,
    dragInsideFrameRef, scheduleDragStateUpdate, clearDragPositionsSoon,
    onUpdateObject, onObjectDragBroadcast, onObjectDragEndBroadcast,
    onPushUndo, getObjectsInFrame, frameManualDragActiveRef,
    selectedIdsRef, getFrameAtPoint
  );

  // Input handling: space/pan, right-click pan, resize, keyboard, selection rect
  const {
    isPanning,
    isAnyPanning,
    spaceHeldRef,
    rightClickPanRef,
    selectionRect,
    setSelectionRect,
    selectionStartRef,
    justFinishedSelectionRef,
    stageWidth,
    stageHeight,
    cursorStyle,
    handleStageDragEnd,
  } = useInputHandling({
    stageRef,
    setViewport,
    activeTool,
    editingObjectId,
    selectedIds,
    selectedConnectorIds,
    objectsRef,
    connectorsRef,
    onDeleteObject,
    onDeleteFrame,
    onDeleteConnector,
    onPushUndo,
    onClearSelection,
    setSelectedConnectorIds,
    setEditingObjectId,
    onSetEditingObject,
    connectorDrawCancel,
    drawingToolsCancel,
    onResetTool,
  });

  // Cache the objects layer as a bitmap while zooming or panning so Konva draws
  // one image instead of hundreds of shapes per frame. Uncache when the
  // interaction ends so normal rendering resumes.
  //
  // The deps include `objects`, `remoteDragPositions`, and `connectors` so
  // that collaborator changes are re-baked into the cached bitmap while
  // panning/zooming. Without these deps the bitmap would freeze and
  // collaborator drags/edits would be invisible until pan/zoom ends.
  //
  // Cost model:
  //  - No collaborator activity → zero re-caches → optimal
  //  - Collaborator dragging → re-cache every ~50ms (broadcast interval)
  //    Each re-cache draws N shapes to a bitmap (~5ms for 500 shapes),
  //    then subsequent frames draw 1 bitmap instead of N shapes.
  const shouldCacheLayer = isZooming || isAnyPanning;
  useEffect(() => {
    const layer = objectsLayerRef.current;
    if (!layer) return;
    if (shouldCacheLayer) {
      layer.clearCache();
      // Konva throws a warning if we try to cache an empty layer
      if (layer.children && layer.children.length > 0) {
        layer.cache();
        // Draw immediately so the updated bitmap is visible this frame
        // (otherwise the stale bitmap persists until the next pan/zoom tick).
        layer.batchDraw();
      }
    } else {
      layer.clearCache();
    }
  }, [shouldCacheLayer, objects, remoteDragPositions, connectors]);

  // Live position resolution: merge local/remote drag positions, compute
  // pop-out/entering frame previews, and resolve frame-child inference.
  const {
    resolvedLiveDragPositions,
    objectsWithLivePositions,
    poppedOutDraggedObjects,
    poppedOutDraggedObjectIds,
    enteringFrameDraggedObjects,
    remoteEnteringDraggedObjectIds,
    remotePoppedOutDraggedObjectIds,
  } = useLivePositions(objects, dragPositions, dragParentFrameIds, remoteDragPositions, dragInsideFrameRef, objectsByFrame, partitionedObjects.frames);

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

      // Skip cursor broadcast while panning — the canvas is moving under the
      // pointer so the canvas-relative position is meaningless and would waste
      // Supabase bandwidth.
      if (!spaceHeldRef.current && !rightClickPanRef.current) {
        onCursorMove(canvasPoint.x, canvasPoint.y);
      }

      // Delegate to extracted hooks
      connectorDrawMouseMove(canvasPoint);
      drawingToolsMouseMove(canvasPoint);
      frameInteractionMouseMove(canvasPoint);

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
    [onCursorMove, getCanvasPoint, activeTool, connectorDrawMouseMove, drawingToolsMouseMove, frameInteractionMouseMove]
  );

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

      // Connector tools: click-click creation workflow
      if (connectorDrawStageClick(canvasPoint)) return;
    },
    [activeTool, getCanvasPoint, editingObjectId, connectorDrawStageClick, onClearSelection, onSetEditingObject]
  );


  const handleConnectorSelect = useCallback(
    (id: string) => {
      // Clear object selection, select this connector
      onClearSelection();
      setSelectedConnectorIds(new Set([id]));
    },
    [onClearSelection]
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
      // Only allow text editing in select mode
      if (activeTool !== "select") return;
      const lock = isObjectLocked(id);
      if (lock.locked) return;
      setEditingObjectId(id);
      onSetEditingObject(id);
    },
    [isObjectLocked, onSetEditingObject, activeTool]
  );

  const handleObjectClick = useCallback(
    (id: string, multi?: boolean) => {
      if (isConnectorTool) {
        handleObjectClickForConnector(id);
        return;
      }
      // Only allow selection in select mode
      if (activeTool !== "select") return;
      {
        onSelect(id, multi);
        // After selection changes, update connector selection:
        // Select connectors where both ends are in the (new) selection
        // We need to compute what the new selectedIds will be
        const newSelected = new Set(selectedIdsRef.current);
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
    [activeTool, isConnectorTool, handleObjectClickForConnector, onSelect]
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

      // Drawing tools (frame, rectangle, circle, sticky)
      if (drawingToolsMouseDown(canvasPoint)) return;

      // NOTE: Do NOT cancel connectorDraw on mousedown — that fires before the
      // click event, so clearing here would immediately restart the draw
      // when the click handler runs next (infinite loop).  Cancellation is
      // handled exclusively by Escape and by the click/tap handlers.
      if (isConnectorTool) return;

      if (activeTool !== "select") return;

      selectionStartRef.current = canvasPoint;
    },
    [activeTool, getCanvasPoint, drawingToolsMouseDown, isConnectorTool]
  );

  const handleMouseUp = useCallback(() => {
    // Drawing tools (frame, rectangle, circle, sticky creation)
    if (drawingToolsMouseUp()) return;

    // Selection rect finalization
    if (selectionRect.visible) {
      const rect = {
        x: Math.min(selectionRect.x, selectionRect.x + selectionRect.width),
        y: Math.min(selectionRect.y, selectionRect.y + selectionRect.height),
        width: Math.abs(selectionRect.width),
        height: Math.abs(selectionRect.height),
      };

      // Only process if drag was meaningful (> 5px)
      if (rect.width > 5 && rect.height > 5) {
        const selectedObjIds = getObjectIdsInRect(objectsRef.current, rect);
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
    frameInteractionMouseUp();
  }, [
    drawingToolsMouseUp,
    selectionRect,
    onSelect,
    onClearSelection,
    frameInteractionMouseUp,
  ]);

  const editingObject = editingObjectId ? objects[editingObjectId] : null;

  // Pre-compute lock status and draft text maps so we avoid calling isObjectLocked()
  // and getDraftTextForObject() inline per-object (which creates new objects each render
  // and defeats React.memo).
  const lockStatusMap = useMemo(() => {
    const map: Record<string, { locked: boolean; lockedBy?: string; lockedByColor?: string }> = {};
    // Only populate entries for locked objects — unlocked objects will use the shared default
    for (const [uid, user] of Object.entries(users)) {
      if (uid !== currentUserId && user.editingObjectId) {
        map[user.editingObjectId] = {
          locked: true,
          lockedBy: user.displayName,
          lockedByColor: user.cursorColor,
        };
      }
    }
    return map;
  }, [users, currentUserId]);

  const draftTextMap = useMemo(() => {
    const map: Record<string, string> = {};
    for (const [uid, user] of Object.entries(users)) {
      if (uid !== currentUserId && user.editingObjectId && user.draftText) {
        map[user.editingObjectId] = user.draftText;
      }
    }
    return map;
  }, [users, currentUserId]);

  const DEFAULT_LOCK = { locked: false } as const;

  // Viewport culling: filter partitioned objects to only those visible on screen
  const {
    visibleBounds,
    isInViewport,
    visibleShapes,
    visibleStickies,
    visibleFrames,
    visibleLines,
    clippedObjectsByFrame,
  } = useViewportCulling(
    viewport, 
    stageWidth, 
    stageHeight, 
    partitionedObjects, 
    draggingRef,
    Object.keys(resolvedLiveDragPositions),
    remotePoppedOutDraggedObjectIds,
    enteringFrameDraggedObjects,
    objectsByFrame
  );

  return (
    <div
      className="relative w-full h-full overflow-hidden bg-gray-50"
      style={{ cursor: cursorStyle }}
    >
      <GridBackground viewportX={viewport.x} viewportY={viewport.y} viewportScale={viewport.scale} />
      <ToolHints
        activeTool={activeTool}
        isConnectorTool={isConnectorTool}
        isPanning={isPanning}
        hasConnectorDraw={connectorDraw !== null}
        hasFrameDraw={frameDraw !== null}
      />

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
        {/* Objects layer — cached as bitmap during zoom/pan for performance */}
        <Layer ref={objectsLayerRef} listening={!shouldCacheLayer}>
          <DrawingPreviews
            connectorDraw={connectorDraw}
            frameDraw={frameDraw}
            shapeDraw={shapeDraw}
            activeTool={activeTool}
            activeColor={activeColor}
            activeStrokeWidth={activeStrokeWidth}
          />

          {/* Render uncontained objects first (so frame body can sit on top) */}
          {[...visibleShapes, ...visibleStickies]
            .filter((obj) => !remoteEnteringDraggedObjectIds.has(obj.id))
            .map((obj) => {
              const lock = lockStatusMap[obj.id] || DEFAULT_LOCK;
              return (
                <BoardObjectRenderer
                  key={obj.id}
                  object={objectsWithLivePositions[obj.id] || obj}
                  isSelected={selectedIds.has(obj.id)}
                  editingObjectId={editingObjectId}
                  isLockedByOther={lock.locked}
                  lockedBy={lock.lockedBy}
                  lockedByColor={lock.lockedByColor}
                  isArrowHover={connectorHoverObjectId === obj.id}
                  interactable={activeTool === "select"}
                  draftText={draftTextMap[obj.id]}
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
              const frameObj = objectsWithLivePositions[obj.id] || obj;
              const contained = (objectsByFrame[frameObj.id] || []).filter(
                (cobj) => !remotePoppedOutDraggedObjectIds.has(cobj.id) && (draggingRef.current.has(cobj.id) || isInViewport(cobj))
              );
              const entering = enteringFrameDraggedObjects
                .filter((entry) => entry.frameId === frameObj.id)
                .map((entry) => entry.object);
              const enteringIds = new Set(entering.map((o) => o.id));
              const clippedObjects = [...contained, ...entering]
                .filter((o) => o.type !== "line")
                .sort((a, b) => {
                  const dz = (a.zIndex || 0) - (b.zIndex || 0);
                  return dz !== 0 ? dz : a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
                });
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
                    onSelect={handleObjectClick}
                    onDragStart={handleFrameHeaderDragStart}
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
                        const lock = lockStatusMap[cobj.id] || DEFAULT_LOCK;
                        const isEnteringPreview = enteringIds.has(cobj.id);
                        const liveObj = resolvedLiveDragPositions[cobj.id]
                          ? { ...cobj, ...resolvedLiveDragPositions[cobj.id] }
                          : cobj;

                        const rendered = (
                          <BoardObjectRenderer
                            key={cobj.id}
                            object={liveObj}
                            isSelected={selectedIds.has(cobj.id)}
                            editingObjectId={editingObjectId}
                            isLockedByOther={lock.locked}
                            lockedBy={lock.lockedBy}
                            lockedByColor={lock.lockedByColor}
                            isArrowHover={connectorHoverObjectId === cobj.id}
                            interactable={activeTool === "select"}
                            draftText={draftTextMap[cobj.id]}
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
                          const from = conn.fromId ? objectsWithLivePositions[conn.fromId] : undefined;
                          const to = conn.toId ? objectsWithLivePositions[conn.toId] : undefined;
                          // Need at least a resolvable source and target (object or free point)
                          if (!from && !conn.fromPoint) return null;
                          if (!to && !conn.toPoint) return null;
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
            const lock = lockStatusMap[obj.id] || DEFAULT_LOCK;
            return (
              <Group key={`popout-${obj.id}`} listening={false}>
                <BoardObjectRenderer
                  object={obj}
                  isSelected={selectedIds.has(obj.id)}
                  editingObjectId={editingObjectId}
                  isLockedByOther={lock.locked}
                  lockedBy={lock.lockedBy}
                  lockedByColor={lock.lockedByColor}
                  isArrowHover={connectorHoverObjectId === obj.id}
                  interactable={activeTool === "select"}
                  draftText={draftTextMap[obj.id]}
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
              </Group>
            );
          })}

          {/* Frame overlays (header + border on top) */}
          {visibleFrames.map((obj) => {
              const frameObj = objectsWithLivePositions[obj.id] || obj;
              const framePos =
                resolvedLiveDragPositions[frameObj.id] || { x: frameObj.x, y: frameObj.y };
              const { contained } =
                clippedObjectsByFrame[frameObj.id] ?? { contained: [] };
              const fMinSizes = frameMinSizes[obj.id];
              const overlayObj = (framePos.x === frameObj.x && framePos.y === frameObj.y) 
                ? frameObj 
                : { ...frameObj, x: framePos.x, y: framePos.y };

              return (
                <FrameOverlay
                  key={`overlay-${obj.id}`}
                  object={overlayObj}
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
          <TopLevelConnectors
            connectors={connectors}
            objects={objects}
            objectsWithLivePositions={objectsWithLivePositions}
            poppedOutDraggedObjectIds={poppedOutDraggedObjectIds}
            selectedConnectorIds={selectedConnectorIds}
            onConnectorSelect={handleConnectorSelect}
            visibleBounds={visibleBounds}
          />

          {/* All lines render on top (never clipped, like connectors) */}
          {visibleLines.map((obj) => {
              return (
              <BoardObjectRenderer
                key={obj.id}
                object={objectsWithLivePositions[obj.id] || obj}
                isSelected={selectedIds.has(obj.id)}
                editingObjectId={null}
                isLockedByOther={false}
                isArrowHover={false}
                interactable={activeTool === "select"}
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

          {/* Selection rectangle */}
          <SelectionRect {...selectionRect} />
        </Layer>

        {/* Cursors layer — isolated component so interpolation rAF
            only re-renders cursors, not the entire Board */}
        <RemoteCursorsLayer
          cursorStore={cursorStore}
          users={users}
          currentUserId={currentUserId}
        />
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
});
