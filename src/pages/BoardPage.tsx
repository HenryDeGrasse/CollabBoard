import { useState, useEffect, useCallback, useRef } from "react";
import type { BoardObject, Connector } from "../types/board";
import { Board, type ToolType } from "../components/canvas/Board";
import { Toolbar } from "../components/toolbar/Toolbar";
import { PresencePanel } from "../components/sidebar/PresencePanel";
import { AICommandInput } from "../components/sidebar/AICommandInput";
import { useBoard } from "../hooks/useBoard";
import { usePresence } from "../hooks/usePresence";
import { useCanvas } from "../hooks/useCanvas";
import { useSelection } from "../hooks/useSelection";
import { useAIAgent } from "../hooks/useAIAgent";
import { useUndoRedo } from "../hooks/useUndoRedo";
import { useAuth } from "../components/auth/AuthProvider";
import { HelpPanel } from "../components/ui/HelpPanel";
import { createBoard, getBoardMetadata, addBoardToUser } from "../services/board";
import { DEFAULT_STICKY_COLOR } from "../utils/colors";

interface BoardPageProps {
  boardId: string;
  onNavigateHome?: () => void;
}

export function BoardPage({ boardId, onNavigateHome }: BoardPageProps) {
  const { user, displayName } = useAuth();
  const userId = user?.uid || "";

  const [activeTool, setActiveTool] = useState<ToolType>("select");
  const [activeColor, setActiveColor] = useState<string>(DEFAULT_STICKY_COLOR);
  const [initialized, setInitialized] = useState(false);
  const [copied, setCopied] = useState(false);

  const {
    objects,
    connectors,
    createObject,
    updateObject,
    deleteObject,
    createConnector,
    deleteConnector,
    restoreObject,
    restoreConnector,
    loading,
  } = useBoard(boardId);
  const { users, updateCursor, setEditingObject, setDraftText, isObjectLocked, getDraftTextForObject } =
    usePresence(boardId, userId, displayName);
  const canvas = useCanvas();
  const selection = useSelection();
  const aiAgent = useAIAgent(boardId, canvas.stageRef, selection.selectedIds);
  const undoRedo = useUndoRedo(
    createObject,
    updateObject,
    deleteObject,
    createConnector,
    deleteConnector,
    restoreObject,
    restoreConnector,
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
    };
    return () => { delete (window as any).__COLLABBOARD__; };
  }, [boardId, createObject, objects]);

  // Initialize board metadata if it doesn't exist
  useEffect(() => {
    if (!boardId || !userId || initialized) return;

    getBoardMetadata(boardId).then(async (metadata) => {
      if (!metadata) {
        await createBoard(boardId, "Untitled Board", userId, displayName || "Anonymous");
      } else {
        // Board exists — make sure it's in user's board list (e.g., joined via link)
        await addBoardToUser(userId, boardId);
      }
      setInitialized(true);
    });
  }, [boardId, userId, initialized]);

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

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="flex items-center gap-3">
          <div className="animate-spin w-6 h-6 border-2 border-indigo-500 border-t-transparent rounded-full" />
          <span className="text-gray-600 font-medium">Loading board...</span>
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

      {/* Presence panel */}
      <PresencePanel
        users={users}
        currentUserId={userId}
        onShareClick={() => {
          const url = window.location.href;
          navigator.clipboard.writeText(url).then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
          });
        }}
        linkCopied={copied}
      />

      {/* Back to Dashboard button */}
      <div className="fixed top-4 left-4 z-50">
        <button
          onClick={() => onNavigateHome?.()}
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
        onCreateConnector={createConnector}
        onDeleteConnector={deleteConnector}
        onCursorMove={handleCursorMove}
        onSetEditingObject={setEditingObject}
        onDraftTextChange={setDraftText}
        getDraftTextForObject={getDraftTextForObject}
        isObjectLocked={isObjectLocked}
        onPushUndo={undoRedo.pushAction}
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
    </div>
  );
}
