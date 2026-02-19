import React, { useState, useCallback, useMemo, useRef } from "react";
import { Stage, Layer, Group } from "react-konva";
import Konva from "konva";
import { Frame, FrameOverlay } from "./Frame";
import { ConnectorLine } from "./Connector";
import { RemoteCursor } from "./RemoteCursor";
import { SelectionRect } from "./SelectionRect";
import { TextOverlay } from "./TextOverlay";
import { BoardObjectRenderer } from "./BoardObjectRenderer";
import { DrawingPreviews } from "./DrawingPreviews";
import { ToolHints } from "./ToolHints";
import { GridBackground } from "./GridBackground";
import { TopLevelConnectors } from "./TopLevelConnectors";
import type { BoardObject, Connector } from "../../types/board";
import type { UndoAction } from "../../hooks/useUndoRedo";
import type { UserPresence } from "../../types/presence";
import type { UseCanvasReturn } from "../../hooks/useCanvas";
import { useCursorInterpolation } from "../../hooks/useCursorInterpolation";
import { useObjectPartitioning } from "../../hooks/useObjectPartitioning";
import { useViewportCulling } from "../../hooks/useViewportCulling";
import { useLivePositions } from "../../hooks/useLivePositions";
import { useDragSystem } from "../../hooks/useDragSystem";
import { useConnectorDraw } from "../../hooks/useConnectorDraw";
import { useDrawingTools } from "../../hooks/useDrawingTools";
import { useFrameInteraction } from "../../hooks/useFrameInteraction";
import { useInputHandling } from "../../hooks/useInputHandling";

import { getObjectIdsInRect, getConnectorIdsInRect } from "../../utils/selection";
import {
  constrainChildrenInFrame
} from "../../utils/frame-containment";
import { getFrameHeaderHeight } from "../../utils/text-style";

export type ToolType = "select" | "sticky" | "rectangle" | "circle" | "arrow" | "line" | "frame";

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
    setNodeTopLeft,
  } = useDragSystem({
    objectsRef,
    selectedIds,
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
    frameManualDrag,
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
    onPushUndo, getObjectsInFrame, frameManualDragActiveRef
  );

  // Input handling: space/pan, right-click pan, resize, keyboard, selection rect
  const {
    isPanning,
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

  // Live position resolution: merge local/remote drag positions, compute
  // pop-out/entering frame previews, and resolve frame-child inference.
  const {
    resolvedLiveDragPositions,
    objectsWithLivePositions,
    withLivePosition,
    poppedOutDraggedObjects,
    poppedOutDraggedObjectIds,
    enteringFrameDraggedObjects,
    remoteEnteringDraggedObjectIds,
    remotePoppedOutDraggedObjectIds,
  } = useLivePositions(objects, dragPositions, dragParentFrameIds, remoteDragPositions, dragInsideFrameRef);

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
    [activeTool, isConnectorTool, handleObjectClickForConnector, onSelect, selectedIds]
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

  // Viewport culling: filter partitioned objects to only those visible on screen
  const {
    visibleShapes,
    visibleStickies,
    visibleFrames,
    visibleLines,
  } = useViewportCulling(viewport, stageWidth, stageHeight, partitionedObjects, draggingRef);

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
        {/* Objects layer */}
        <Layer>
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
              const lock = isObjectLocked(obj.id);
              return (
                <BoardObjectRenderer
                  key={obj.id}
                  object={withLivePosition(objects[obj.id] || obj)}
                  isSelected={selectedIds.has(obj.id)}
                  editingObjectId={editingObjectId}
                  isLockedByOther={lock.locked}
                  lockedBy={lock.lockedBy}
                  lockedByColor={lock.lockedByColor}
                  isArrowHover={connectorHoverObjectId === obj.id}
                  interactable={activeTool === "select"}
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
            const lock = isObjectLocked(obj.id);
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
          <TopLevelConnectors
            connectors={connectors}
            objects={objects}
            objectsWithLivePositions={objectsWithLivePositions}
            poppedOutDraggedObjectIds={poppedOutDraggedObjectIds}
            selectedConnectorIds={selectedConnectorIds}
            onConnectorSelect={handleConnectorSelect}
          />

          {/* All lines render on top (never clipped, like connectors) */}
          {visibleLines.map((obj) => (
              <BoardObjectRenderer
                key={obj.id}
                object={withLivePosition(objects[obj.id] || obj)}
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
