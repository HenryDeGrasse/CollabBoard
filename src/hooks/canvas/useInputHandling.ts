import { useState, useCallback, useRef, useEffect } from "react";
import Konva from "konva";
import type { BoardObject, Connector } from "../../types/board";
import type { UndoAction } from "../useUndoRedo";
import type { ToolType } from "../../types/tool";

export interface SelectionRectState {
  x: number;
  y: number;
  width: number;
  height: number;
  visible: boolean;
}

export interface UseInputHandlingParams {
  stageRef: React.RefObject<Konva.Stage | null>;
  setViewport: React.Dispatch<React.SetStateAction<{ x: number; y: number; scale: number }>>;
  activeTool: ToolType;
  editingObjectId: string | null;
  selectedIds: Set<string>;
  selectedConnectorIds: Set<string>;
  objectsRef: React.MutableRefObject<Record<string, BoardObject>>;
  connectorsRef: React.MutableRefObject<Record<string, Connector>>;
  onDeleteObject: (id: string) => void;
  onDeleteFrame: (frameId: string) => void;
  onDeleteConnector: (id: string) => void;
  onPushUndo: (action: UndoAction) => void;
  onClearSelection: () => void;
  setSelectedConnectorIds: (ids: Set<string>) => void;
  setEditingObjectId: (id: string | null) => void;
  onSetEditingObject: (objectId: string | null) => void;
  connectorDrawCancel: () => void;
  drawingToolsCancel: () => void;
  onResetTool: (selectId?: string) => void;
}

export interface UseInputHandlingReturn {
  isPanning: boolean;
  /** True while ANY pan is active (space+drag OR right-click drag) — used for
   *  layer caching and disabling hit detection during pan. */
  isAnyPanning: boolean;
  spaceHeldRef: React.MutableRefObject<boolean>;
  rightClickPanRef: React.MutableRefObject<{
    startX: number;
    startY: number;
    viewX: number;
    viewY: number;
  } | null>;
  selectionRect: SelectionRectState;
  setSelectionRect: React.Dispatch<React.SetStateAction<SelectionRectState>>;
  selectionStartRef: React.MutableRefObject<{ x: number; y: number } | null>;
  justFinishedSelectionRef: React.MutableRefObject<boolean>;
  stageWidth: number;
  stageHeight: number;
  cursorStyle: string;
  handleStageDragEnd: (e: Konva.KonvaEventObject<DragEvent>) => void;
}

export function useInputHandling({
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
}: UseInputHandlingParams): UseInputHandlingReturn {
  // ─── Space key (pan mode) ─────────────────────────────────
  const [spaceHeld, setSpaceHeld] = useState(false);
  const spaceHeldRef = useRef(false);

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

  const isPanning = spaceHeld;

  // ─── Right-click drag panning ─────────────────────────────
  // Uses the same imperative pattern as zoom: apply stage.x/y directly during
  // drag (zero React renders), commit to React state on mouseUp.
  const [isRightClickPanning, setIsRightClickPanning] = useState(false);
  const rightClickPanRef = useRef<{
    startX: number;
    startY: number;
    viewX: number;
    viewY: number;
  } | null>(null);

  useEffect(() => {
    const container = stageRef.current?.container();
    if (!container) return;

    const onContextMenu = (e: Event) => {
      e.preventDefault();
    };

    const onMouseDown = (e: MouseEvent) => {
      if (e.button === 2) {
        e.preventDefault();
        const stage = stageRef.current;
        rightClickPanRef.current = {
          startX: e.clientX,
          startY: e.clientY,
          viewX: stage?.x() ?? 0,
          viewY: stage?.y() ?? 0,
        };
        setIsRightClickPanning(true);
      }
    };

    const onMouseMove = (e: MouseEvent) => {
      if (!rightClickPanRef.current) return;
      const dx = e.clientX - rightClickPanRef.current.startX;
      const dy = e.clientY - rightClickPanRef.current.startY;
      const newX = rightClickPanRef.current.viewX + dx;
      const newY = rightClickPanRef.current.viewY + dy;

      // Apply directly to Konva Stage — no React render.
      const stage = stageRef.current;
      if (stage) {
        stage.x(newX);
        stage.y(newY);
        stage.batchDraw();
      }
    };

    const onMouseUp = (e: MouseEvent) => {
      if (e.button === 2 && rightClickPanRef.current) {
        rightClickPanRef.current = null;
        setIsRightClickPanning(false);
        // Commit final position to React state (one render for culling update).
        const stage = stageRef.current;
        if (stage) {
          setViewport((prev) => ({ ...prev, x: stage.x(), y: stage.y() }));
        }
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

  const isAnyPanning = isPanning || isRightClickPanning;

  // ─── Window resize / stage size ───────────────────────────
  const [stageSize, setStageSize] = useState({
    width: window.innerWidth,
    height: window.innerHeight,
  });

  useEffect(() => {
    const handleResize = () => {
      setStageSize({ width: window.innerWidth, height: window.innerHeight });
    };
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  // ─── Selection rect ───────────────────────────────────────
  const [selectionRect, setSelectionRect] = useState<SelectionRectState>({
    x: 0,
    y: 0,
    width: 0,
    height: 0,
    visible: false,
  });
  const selectionStartRef = useRef<{ x: number; y: number } | null>(null);
  const justFinishedSelectionRef = useRef(false);

  // ─── Keyboard delete + escape ─────────────────────────────
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
        connectorDrawCancel();
        drawingToolsCancel();
        if (editingObjectId) {
          setEditingObjectId(null);
          onSetEditingObject(null);
        }
        onClearSelection();
        setSelectedConnectorIds(new Set());
        onResetTool();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [
    selectedIds, selectedConnectorIds, editingObjectId,
    objectsRef, connectorsRef,
    onDeleteObject, onDeleteFrame, onDeleteConnector,
    onPushUndo, onClearSelection, setSelectedConnectorIds,
    setEditingObjectId, onSetEditingObject,
    connectorDrawCancel, drawingToolsCancel, onResetTool,
  ]);

  // ─── Stage drag end (pan commit) ─────────────────────────
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

  // ─── Cursor style ────────────────────────────────────────
  const isConnectorTool = activeTool === "arrow" || activeTool === "line";
  const cursorStyle = isPanning
    ? "grab"
    : isConnectorTool
    ? "crosshair"
    : activeTool === "select"
    ? "default"
    : "crosshair";

  return {
    isPanning,
    isAnyPanning,
    spaceHeldRef,
    rightClickPanRef,
    selectionRect,
    setSelectionRect,
    selectionStartRef,
    justFinishedSelectionRef,
    stageWidth: stageSize.width,
    stageHeight: stageSize.height,
    cursorStyle,
    handleStageDragEnd,
  };
}
