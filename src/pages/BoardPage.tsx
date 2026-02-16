import { useState, useEffect, useCallback } from "react";
import { Board, type ToolType } from "../components/canvas/Board";
import { Toolbar } from "../components/toolbar/Toolbar";
import { PresencePanel } from "../components/sidebar/PresencePanel";
import { AICommandInput } from "../components/sidebar/AICommandInput";
import { useBoard } from "../hooks/useBoard";
import { usePresence } from "../hooks/usePresence";
import { useCanvas } from "../hooks/useCanvas";
import { useSelection } from "../hooks/useSelection";
import { useAIAgent } from "../hooks/useAIAgent";
import { useAuth } from "../components/auth/AuthProvider";
import { createBoard, getBoardMetadata } from "../services/board";
import { DEFAULT_STICKY_COLOR } from "../utils/colors";

interface BoardPageProps {
  boardId: string;
}

export function BoardPage({ boardId }: BoardPageProps) {
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
    loading,
  } = useBoard(boardId);
  const { users, updateCursor, setEditingObject, isObjectLocked, myColor } =
    usePresence(boardId, userId, displayName);
  const canvas = useCanvas();
  const selection = useSelection();
  const aiAgent = useAIAgent(boardId, userId);

  // Initialize board metadata if it doesn't exist
  useEffect(() => {
    if (!boardId || !userId || initialized) return;

    getBoardMetadata(boardId).then((metadata) => {
      if (!metadata) {
        createBoard(boardId, "Untitled Board", userId);
      }
      setInitialized(true);
    });
  }, [boardId, userId, initialized]);

  // Keyboard shortcuts for tools
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement
      ) {
        return;
      }

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
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

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
      <PresencePanel users={users} currentUserId={userId} />

      {/* Board info + share link */}
      <div className="fixed top-4 left-4 z-50 flex items-center gap-2">
        <div
          className="w-3 h-3 rounded-full"
          style={{ backgroundColor: myColor }}
        />
        <span className="text-sm text-gray-600 bg-white/80 backdrop-blur px-2 py-1 rounded">
          {displayName}
        </span>
        <button
          onClick={() => {
            const url = window.location.href;
            navigator.clipboard.writeText(url).then(() => {
              setCopied(true);
              setTimeout(() => setCopied(false), 2000);
            });
          }}
          className="flex items-center gap-1 text-xs bg-white/80 backdrop-blur px-2.5 py-1.5 rounded border border-gray-200 text-gray-600 hover:bg-white hover:text-gray-800 transition"
        >
          {copied ? "✓ Copied!" : "📋 Share Board"}
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
        onCursorMove={handleCursorMove}
        onSetEditingObject={setEditingObject}
        isObjectLocked={isObjectLocked}
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
    </div>
  );
}
