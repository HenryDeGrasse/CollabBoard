import { useState, useCallback, useMemo, useRef, useEffect } from "react";
import { Stage, Layer, Arrow } from "react-konva";
import Konva from "konva";
import { StickyNote } from "./StickyNote";
import { Shape } from "./Shape";
import { ConnectorLine } from "./Connector";
import { RemoteCursor } from "./RemoteCursor";
import { SelectionRect } from "./SelectionRect";
import { TextOverlay } from "./TextOverlay";
import type { BoardObject, Connector } from "../../types/board";
import type { UserPresence } from "../../types/presence";
import type { UseCanvasReturn } from "../../hooks/useCanvas";
import { throttle } from "../../utils/throttle";

export type ToolType = "select" | "sticky" | "rectangle" | "circle" | "arrow";

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
  onCursorMove: (x: number, y: number) => void;
  onSetEditingObject: (objectId: string | null) => void;
  isObjectLocked: (objectId: string) => { locked: boolean; lockedBy?: string; lockedByColor?: string };
  onResetTool: (selectId?: string) => void;
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
  onCursorMove,
  onSetEditingObject,
  isObjectLocked,
  onResetTool,
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
  const draggingRef = useRef<Set<string>>(new Set());
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

      // Selection rect drag
      if (selectionStartRef.current && activeTool === "select" && !spaceHeldRef.current) {
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
    [onCursorMove, getCanvasPoint, activeTool, arrowDraw]
  );

  const handleStageClick = useCallback(
    (e: Konva.KonvaEventObject<MouseEvent>) => {
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
        return;
      }

      if (activeTool === "arrow") {
        // Cancel arrow on empty click
        if (arrowDraw) setArrowDraw(null);
        return;
      }

      // Create object at click position
      const maxZIndex = Math.max(0, ...Object.values(objects).map((o) => o.zIndex || 0));

      if (activeTool === "sticky") {
        const newId = onCreateObject({
          type: "sticky",
          x: canvasPoint.x - 75,
          y: canvasPoint.y - 75,
          width: 150,
          height: 150,
          color: activeColor,
          text: "",
          rotation: 0,
          zIndex: maxZIndex + 1,
          createdBy: currentUserId,
        });
        onResetTool(newId);
      } else if (activeTool === "rectangle") {
        const newId = onCreateObject({
          type: "rectangle",
          x: canvasPoint.x - 75,
          y: canvasPoint.y - 50,
          width: 150,
          height: 100,
          color: activeColor,
          text: "",
          rotation: 0,
          zIndex: maxZIndex + 1,
          createdBy: currentUserId,
        });
        onResetTool(newId);
      } else if (activeTool === "circle") {
        const newId = onCreateObject({
          type: "circle",
          x: canvasPoint.x - 50,
          y: canvasPoint.y - 50,
          width: 100,
          height: 100,
          color: activeColor,
          text: "",
          rotation: 0,
          zIndex: maxZIndex + 1,
          createdBy: currentUserId,
        });
        onResetTool(newId);
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
      onCreateObject,
      onClearSelection,
      onSetEditingObject,
      onResetTool,
    ]
  );

  const handleDragStart = useCallback((id: string) => {
    draggingRef.current.add(id);
  }, []);

  const handleDragMove = useCallback(
    (id: string, x: number, y: number) => {
      throttledDragUpdate(id, x, y);
      // Also broadcast cursor position during drag
      const stage = stageRef.current;
      if (stage) {
        const pointer = stage.getPointerPosition();
        if (pointer) {
          const cx = (pointer.x - stage.x()) / stage.scaleX();
          const cy = (pointer.y - stage.y()) / stage.scaleY();
          onCursorMove(cx, cy);
        }
      }
    },
    [throttledDragUpdate, stageRef, onCursorMove]
  );

  const handleDragEnd = useCallback(
    (id: string, x: number, y: number) => {
      draggingRef.current.delete(id);
      onUpdateObject(id, { x, y });
    },
    [onUpdateObject]
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
      }
    },
    [activeTool, handleObjectClickForArrow, onSelect]
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
        // Use intersection (any overlap) instead of full containment
        const selectedObjIds = Object.values(objects)
          .filter(
            (obj) =>
              obj.x < rect.x + rect.width &&
              obj.x + obj.width > rect.x &&
              obj.y < rect.y + rect.height &&
              obj.y + obj.height > rect.y
          )
          .map((obj) => obj.id);

        if (selectedObjIds.length > 0) {
          // Clear first, then add all
          onClearSelection();
          selectedObjIds.forEach((id) => onSelect(id, true));
          justFinishedSelectionRef.current = true;
        } else {
          justFinishedSelectionRef.current = true; // Still prevent click clearing after drag
        }
      }
    }

    selectionStartRef.current = null;
    setSelectionRect((prev) => ({ ...prev, visible: false }));
  }, [selectionRect, objects, onSelect, onClearSelection]);

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
        selectedIds.forEach((id) => onDeleteObject(id));
        onClearSelection();
      }
      if (e.key === "Escape") {
        setArrowDraw(null);
        if (editingObjectId) {
          setEditingObjectId(null);
          onSetEditingObject(null);
        }
        onClearSelection();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [selectedIds, editingObjectId, onDeleteObject, onClearSelection, onSetEditingObject]);

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
    : activeTool === "arrow"
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
            <ConnectorLine key={conn.id} connector={conn} objects={objects} />
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

          {/* Render shapes (rectangles, circles, lines) */}
          {sortedObjects
            .filter((obj) => ["rectangle", "circle", "line"].includes(obj.type))
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
                  onSelect={handleObjectClick}
                  onDragStart={handleDragStart}
                  onDragMove={handleDragMove}
                  onDragEnd={handleDragEnd}
                  onDoubleClick={handleDoubleClick}
                  onUpdateObject={onUpdateObject}
                />
              );
            })}

          {/* Render sticky notes */}
          {sortedObjects
            .filter((obj) => obj.type === "sticky")
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
                  onSelect={handleObjectClick}
                  onDragStart={handleDragStart}
                  onDragMove={handleDragMove}
                  onDragEnd={handleDragEnd}
                  onDoubleClick={handleDoubleClick}
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
        />
      )}
    </div>
  );
}
