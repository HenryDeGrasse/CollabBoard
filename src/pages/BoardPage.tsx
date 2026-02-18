import { useState, useEffect, useCallback, useRef } from "react";
import type { BoardObject, Connector } from "../types/board";
import { Board, type ToolType } from "../components/canvas/Board";
import { Toolbar } from "../components/toolbar/Toolbar";
import { PresencePanel } from "../components/sidebar/PresencePanel";
import { AICommandInput } from "../components/sidebar/AICommandInput";
import { TextStylePanel } from "../components/sidebar/TextStylePanel";
import { useBoard } from "../hooks/useBoard";
import { usePresence } from "../hooks/usePresence";
import { useCanvas } from "../hooks/useCanvas";
import { useSelection } from "../hooks/useSelection";
import { useAIAgent } from "../hooks/useAIAgent";
import { useUndoRedo } from "../hooks/useUndoRedo";
import { useAuth } from "../components/auth/AuthProvider";
import { HelpPanel } from "../components/ui/HelpPanel";
import { joinBoard, touchBoard } from "../services/board";
import { DEFAULT_STICKY_COLOR } from "../utils/colors";
import {
  isTextCapableObjectType,
  resolveObjectTextSize,
  clampTextSizeForType,
  getAutoContrastingTextColor,
} from "../utils/text-style";

interface BoardPageProps {
  boardId: string;
  onNavigateHome?: () => void;
}

export function BoardPage({ boardId, onNavigateHome }: BoardPageProps) {
  const { user, displayName } = useAuth();
  const userId = user?.id || "";

  const [activeTool, setActiveTool] = useState<ToolType>("select");
  const [activeColor, setActiveColor] = useState<string>(DEFAULT_STICKY_COLOR);
  const [isRotating, setIsRotating] = useState(false);

  const [joined, setJoined] = useState(false);

  // Ensure user is a member of this board BEFORE loading data.
  // RLS policies require board_members entry for SELECT access.
  useEffect(() => {
    if (!boardId || !userId) return;
    let cancelled = false;

    joinBoard(boardId, userId)
      .then(() => touchBoard(boardId))
      .catch((err) => console.error("Failed to join board:", err))
      .finally(() => {
        if (!cancelled) setJoined(true);
      });

    return () => { cancelled = true; };
  }, [boardId, userId]);

  const {
    objects,
    connectors,
    createObject,
    updateObject,
    deleteObject,
    deleteFrameCascade,
    createConnector,
    deleteConnector,
    restoreObject,
    restoreObjects,
    restoreConnector,
    loading,
  } = useBoard(joined ? boardId : "");
  const {
    users,
    remoteDragPositions,
    updateCursor,
    setEditingObject,
    setDraftText,
    broadcastObjectDrag,
    endObjectDrag,
    isObjectLocked,
    getDraftTextForObject,
  } = usePresence(boardId, userId, displayName);
  const canvas = useCanvas(boardId);
  const selection = useSelection();
  const aiAgent = useAIAgent(boardId, canvas.stageRef, selection.selectedIds);

  // ── Thumbnail capture ────────────────────────────────────────
  const captureThumbnail = useCallback(() => {
    const stage = canvas.stageRef.current;
    if (!stage || !boardId) return;
    try {
      const dataUrl = stage.toDataURL({ pixelRatio: 0.25, mimeType: "image/jpeg", quality: 0.6 });
      localStorage.setItem(`collabboard-thumb-${boardId}`, dataUrl);
    } catch {
      // Canvas tainted or unavailable — ignore
    }
  }, [boardId, canvas.stageRef]);

  // Capture on unmount (e.g. SPA navigation away)
  useEffect(() => () => captureThumbnail(), [captureThumbnail]);
  const undoRedo = useUndoRedo(
    createObject,
    updateObject,
    deleteObject,
    createConnector,
    deleteConnector,
    restoreObject,
    restoreConnector,
    restoreObjects,
  );

  // Clipboard for copy/paste
  const clipboardRef = useRef<{ objects: BoardObject[]; connectors: Connector[] }>({
    objects: [],
    connectors: [],
  });

  // Refs for stable keyboard handler access to current state
  const objectsRef = useRef(objects);
  objectsRef.current = objects;
  const connectorsRef = useRef(connectors);
  connectorsRef.current = connectors;
  const selectionRef = useRef(selection);
  selectionRef.current = selection;

  // Expose board functions for E2E testing
  useEffect(() => {
    (window as any).__COLLABBOARD__ = {
      boardId,
      createObject,
      objects,
      connectors,
    };
    return () => { delete (window as any).__COLLABBOARD__; };
  }, [boardId, createObject, objects, connectors]);

  // (join handled above, before useBoard initialization)

  // Keyboard shortcuts for tools + undo/redo + copy/paste/duplicate
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement
      ) {
        return;
      }

      const ctrl = e.ctrlKey || e.metaKey;

      // Undo: Ctrl+Z
      if (ctrl && e.key === "z" && !e.shiftKey) {
        e.preventDefault();
        undoRedo.undo();
        return;
      }

      // Redo: Ctrl+Shift+Z or Ctrl+Y
      if (ctrl && ((e.key === "z" && e.shiftKey) || e.key === "y")) {
        e.preventDefault();
        undoRedo.redo();
        return;
      }

      // Copy: Ctrl+C
      if (ctrl && e.key === "c") {
        e.preventDefault();
        const sel = selectionRef.current;
        const objs = objectsRef.current;
        const conns = connectorsRef.current;
        const selectedObjs = Array.from(sel.selectedIds)
          .map((id) => objs[id])
          .filter(Boolean);
        const selectedConns = Object.values(conns).filter(
          (c) => sel.selectedIds.has(c.fromId) && sel.selectedIds.has(c.toId)
        );
        clipboardRef.current = {
          objects: selectedObjs.map((o) => ({ ...o })),
          connectors: selectedConns.map((c) => ({ ...c })),
        };
        return;
      }

      // Paste: Ctrl+V
      if (ctrl && e.key === "v") {
        e.preventDefault();
        const sel = selectionRef.current;
        const { objects: clipObjs, connectors: clipConns } = clipboardRef.current;
        if (clipObjs.length === 0) return;

        const OFFSET = 20;
        const idMap: Record<string, string> = {};

        for (const obj of clipObjs) {
          const newId = createObject({
            type: obj.type,
            x: obj.x + OFFSET,
            y: obj.y + OFFSET,
            width: obj.width,
            height: obj.height,
            color: obj.color,
            text: obj.text,
            textSize: obj.textSize,
            textColor: obj.textColor,
            rotation: obj.rotation,
            zIndex: obj.zIndex,
            createdBy: userId,
            points: obj.points,
            strokeWidth: obj.strokeWidth,
          });
          idMap[obj.id] = newId;
        }

        for (const conn of clipConns) {
          const newFromId = idMap[conn.fromId];
          const newToId = idMap[conn.toId];
          if (newFromId && newToId) {
            createConnector({ fromId: newFromId, toId: newToId, style: conn.style });
          }
        }

        sel.selectMultiple(Object.values(idMap));

        clipboardRef.current = {
          objects: clipObjs.map((o) => ({ ...o, x: o.x + OFFSET, y: o.y + OFFSET })),
          connectors: clipConns,
        };
        return;
      }

      // Duplicate: Ctrl+D
      if (ctrl && e.key === "d") {
        e.preventDefault();
        const sel = selectionRef.current;
        const objs = objectsRef.current;
        const conns = connectorsRef.current;
        const selectedObjs = Array.from(sel.selectedIds)
          .map((id) => objs[id])
          .filter(Boolean);
        if (selectedObjs.length === 0) return;

        const OFFSET = 20;
        const idMap: Record<string, string> = {};

        for (const obj of selectedObjs) {
          const newId = createObject({
            type: obj.type,
            x: obj.x + OFFSET,
            y: obj.y + OFFSET,
            width: obj.width,
            height: obj.height,
            color: obj.color,
            text: obj.text,
            textSize: obj.textSize,
            textColor: obj.textColor,
            rotation: obj.rotation,
            zIndex: obj.zIndex,
            createdBy: userId,
            points: obj.points,
            strokeWidth: obj.strokeWidth,
          });
          idMap[obj.id] = newId;
        }

        for (const conn of Object.values(conns)) {
          if (sel.selectedIds.has(conn.fromId) && sel.selectedIds.has(conn.toId)) {
            const newFromId = idMap[conn.fromId];
            const newToId = idMap[conn.toId];
            if (newFromId && newToId) {
              createConnector({ fromId: newFromId, toId: newToId, style: conn.style });
            }
          }
        }

        sel.selectMultiple(Object.values(idMap));
        return;
      }

      // Text size shortcuts: Cmd/Ctrl+Shift+.</>
      if (ctrl && e.shiftKey && (e.key === "." || e.key === ">" || e.key === "," || e.key === "<")) {
        e.preventDefault();
        const delta = e.key === "." || e.key === ">" ? 2 : -2;
        const sel = selectionRef.current;
        const objs = objectsRef.current;

        sel.selectedIds.forEach((id) => {
          const obj = objs[id];
          if (!obj || !isTextCapableObjectType(obj.type)) return;
          const base = resolveObjectTextSize(obj);
          const next = clampTextSizeForType(obj.type, base + delta);
          updateObject(id, { textSize: next });
        });

        return;
      }

      // Tool shortcuts (only without ctrl)
      if (!ctrl) {
        switch (e.key.toLowerCase()) {
          case "v":
            setActiveTool("select");
            break;
          case "s":
            setActiveTool("sticky");
            break;
          case "r":
            setActiveTool("rectangle");
            break;
          case "c":
            setActiveTool("circle");
            break;
          case "a":
            setActiveTool("arrow");
            break;
          case "l":
            setActiveTool("line");
            break;
          case "f":
            setActiveTool("frame");
            break;
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [undoRedo, createObject, createConnector, userId]);

  const handleCursorMove = useCallback(
    (x: number, y: number) => {
      updateCursor(x, y);
    },
    [updateCursor]
  );

  // Change color of all selected objects
  const handleChangeSelectedColor = useCallback(
    (color: string) => {
      selection.selectedIds.forEach((id) => {
        updateObject(id, { color });
      });
    },
    [selection.selectedIds, updateObject]
  );

  const selectedObjects = Array.from(selection.selectedIds)
    .map((id) => objects[id])
    .filter(Boolean) as BoardObject[];

  const textStyleTargets = selectedObjects.filter((obj) =>
    isTextCapableObjectType(obj.type)
  );

  const canEditSelectedText = textStyleTargets.length > 0;

  const selectedTextSizes = textStyleTargets.map((obj) => resolveObjectTextSize(obj));
  const selectedTextSize =
    selectedTextSizes.length > 0 &&
    selectedTextSizes.every((s) => s === selectedTextSizes[0])
      ? selectedTextSizes[0]
      : null;

  const selectedResolvedTextColors = textStyleTargets.map((obj) => {
    if (obj.textColor) return obj.textColor;
    if (obj.type === "frame") return "#374151";
    return getAutoContrastingTextColor(obj.color);
  });

  const selectedTextColor =
    selectedResolvedTextColors.length > 0
      ? selectedResolvedTextColors[0]
      : "#111827";

  const handleAdjustSelectedTextSize = useCallback(
    (delta: number) => {
      selection.selectedIds.forEach((id) => {
        const obj = objects[id];
        if (!obj || !isTextCapableObjectType(obj.type)) return;

        const base = resolveObjectTextSize(obj);
        const next = clampTextSizeForType(obj.type, base + delta);
        updateObject(id, { textSize: next });
      });
    },
    [selection.selectedIds, objects, updateObject]
  );

  const handleChangeSelectedTextColor = useCallback(
    (color: string) => {
      selection.selectedIds.forEach((id) => {
        const obj = objects[id];
        if (!obj || !isTextCapableObjectType(obj.type)) return;
        updateObject(id, { textColor: color });
      });
    },
    [selection.selectedIds, objects, updateObject]
  );

  if (!joined || loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="flex items-center gap-3">
          <div className="animate-spin w-6 h-6 border-2 border-indigo-500 border-t-transparent rounded-full" />
          <span className="text-gray-600 font-medium">
            {!joined ? "Joining board..." : "Loading board..."}
          </span>
        </div>
      </div>
    );
  }

  return (
    <div className="w-screen h-screen overflow-hidden">
      {/* Toolbar */}
      <Toolbar
        activeTool={activeTool}
        activeColor={activeColor}
        selectedCount={selection.selectedIds.size}
        selectedColor={
          selection.selectedIds.size > 0
            ? (objects[Array.from(selection.selectedIds)[0]]?.color || "")
            : ""
        }
        onToolChange={setActiveTool}
        onColorChange={setActiveColor}
        onChangeSelectedColor={handleChangeSelectedColor}
      />

      {/* Left-side text style popup */}
      {activeTool === "select" && canEditSelectedText && (
        <TextStylePanel
          textSize={selectedTextSize}
          textColor={selectedTextColor}
          onIncreaseTextSize={() => handleAdjustSelectedTextSize(2)}
          onDecreaseTextSize={() => handleAdjustSelectedTextSize(-2)}
          onChangeTextColor={handleChangeSelectedTextColor}
        />
      )}

      {/* Presence panel */}
      <PresencePanel
        users={users}
        currentUserId={userId}
        boardUrl={window.location.href}
        boardId={boardId}
      />

      {/* Back to Dashboard button */}
      <div className="fixed top-4 left-4 z-50">
        <button
          onClick={() => { captureThumbnail(); onNavigateHome?.(); }}
          className="flex items-center gap-1 text-xs bg-white/80 backdrop-blur px-2.5 py-1.5 rounded-lg border border-gray-200 text-gray-600 hover:bg-white hover:text-gray-800 transition shadow-sm"
          title="Back to Dashboard"
        >
          ← Dashboard
        </button>
      </div>

      {/* Zoom indicator */}
      <div className="fixed bottom-4 left-4 z-50 bg-white/80 backdrop-blur rounded-lg px-3 py-1.5 text-xs text-gray-500 border border-gray-200">
        {Math.round(canvas.viewport.scale * 100)}%
      </div>

      {/* Main canvas */}
      <Board
        objects={objects}
        connectors={connectors}
        users={users}
        currentUserId={userId}
        canvas={canvas}
        selectedIds={selection.selectedIds}
        activeTool={activeTool}
        activeColor={activeColor}
        onSelect={selection.select}
        onClearSelection={selection.clearSelection}
        onCreateObject={createObject}
        onUpdateObject={updateObject}
        onDeleteObject={deleteObject}
        onDeleteFrame={deleteFrameCascade}
        onCreateConnector={createConnector}
        onDeleteConnector={deleteConnector}
        onCursorMove={handleCursorMove}
        remoteDragPositions={remoteDragPositions}
        onObjectDragBroadcast={broadcastObjectDrag}
        onObjectDragEndBroadcast={endObjectDrag}
        onSetEditingObject={setEditingObject}
        onDraftTextChange={setDraftText}
        getDraftTextForObject={getDraftTextForObject}
        isObjectLocked={isObjectLocked}
        onPushUndo={undoRedo.pushAction}
        onRotatingChange={setIsRotating}
        onResetTool={(selectId) => {
          setActiveTool("select");
          if (selectId) {
            selection.clearSelection();
            selection.select(selectId);
          }
        }}
      />

      {/* AI Command Input */}
      <AICommandInput aiAgent={aiAgent} />

      {/* Help Panel */}
      <HelpPanel />

      {/* Rotation hint */}
      {isRotating && (
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 bg-gray-900/80 backdrop-blur text-white text-xs px-4 py-2 rounded-full pointer-events-none">
          Hold <kbd className="px-1.5 py-0.5 bg-white/20 rounded text-[11px] font-medium mx-0.5">Shift</kbd> while rotating to snap to 15° increments
        </div>
      )}
    </div>
  );
}
