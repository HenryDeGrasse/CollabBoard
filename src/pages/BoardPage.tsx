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
import { Link, Copy, Hash, Shield } from "lucide-react";
import {
  isTextCapableObjectType,
  resolveObjectTextSize,
  clampTextSizeForType,
  getAutoContrastingTextColor,
} from "../utils/text-style";

/* ─── Inline board-title editor ──────────────────────────────── */
function BoardTitleEditor({ title, onRename }: { title: string; onRename: (t: string) => void }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(title);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { setDraft(title); }, [title]);
  useEffect(() => { if (editing) inputRef.current?.select(); }, [editing]);

  const commit = () => {
    setEditing(false);
    const trimmed = draft.trim();
    if (trimmed && trimmed !== title) onRename(trimmed);
    else setDraft(title);
  };

  if (!editing) {
    return (
      <button
        onClick={() => setEditing(true)}
        className="text-sm font-medium text-gray-700 hover:text-gray-900 truncate max-w-[260px] px-2 py-1 rounded hover:bg-gray-100 transition"
        title="Click to rename board"
      >
        {title}
      </button>
    );
  }

  return (
    <input
      ref={inputRef}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") commit();
        if (e.key === "Escape") { setDraft(title); setEditing(false); }
      }}
      className="text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded px-2 py-1 outline-none focus:ring-2 focus:ring-emerald-400 w-[220px] text-center"
      maxLength={60}
    />
  );
}

/* ─── Header share button with dropdown ──────────────────────── */
function ShareButton({ boardUrl, boardId }: { boardUrl: string; boardId: string }) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState<"link" | "id" | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const copy = (text: string, what: "link" | "id") => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(what);
      setTimeout(() => setCopied(null), 2000);
    });
    setOpen(false);
  };

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((o) => !o)}
        className="px-2.5 py-1.5 rounded-lg text-xs text-gray-500 hover:text-gray-800 hover:bg-gray-100 transition flex items-center gap-1"
        title="Share board"
      >
        {copied ? (
          <span className="text-emerald-600 font-medium">✓ Copied</span>
        ) : (
          <>
            <Link size={14} />
            <span className="font-medium">Share</span>
          </>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-9 w-48 bg-white rounded-xl shadow-xl border border-gray-200 overflow-hidden z-50">
          <button
            onClick={() => copy(boardUrl, "link")}
            className="w-full flex items-center gap-2.5 px-3 py-2.5 text-sm text-gray-700 hover:bg-emerald-50 hover:text-emerald-700 transition text-left"
          >
            <Copy size={13} className="shrink-0" />
            <span>Copy share link</span>
          </button>
          <div className="h-px bg-gray-100 mx-2" />
          <button
            onClick={() => copy(boardId, "id")}
            className="w-full flex items-center gap-2.5 px-3 py-2.5 text-sm text-gray-700 hover:bg-emerald-50 hover:text-emerald-700 transition text-left"
          >
            <Hash size={13} className="shrink-0" />
            <span>Copy board ID</span>
          </button>
        </div>
      )}
    </div>
  );
}

interface BoardPageProps {
  boardId: string;
  onNavigateHome?: () => void;
}

export function BoardPage({ boardId, onNavigateHome }: BoardPageProps) {
  const { user, displayName } = useAuth();
  const userId = user?.id || "";

  const [activeTool, setActiveTool] = useState<ToolType>("select");
  const [activeColor, setActiveColor] = useState<string>(DEFAULT_STICKY_COLOR);
  const [activeStrokeWidth, setActiveStrokeWidth] = useState<number>(3);
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
    boardTitle,
    updateBoardTitle,
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
  const [editingObjectId, setEditingObjectId] = useState<string | null>(null);

  // Wrap presence setEditingObject to also track locally for TextStylePanel visibility
  const handleSetEditingObject = useCallback((objectId: string | null) => {
    setEditingObjectId(objectId);
    setEditingObject(objectId);
  }, [setEditingObject]);

  // ── Thumbnail capture ────────────────────────────────────────
  // Konva's toDataURL captures transparent pixels. JPEG converts
  // transparency → black. Fix: composite onto a white canvas first.
  const captureThumbnail = useCallback(() => {
    const stage = canvas.stageRef.current;
    if (!stage || !boardId) return;
    try {
      const rawUrl = stage.toDataURL({ pixelRatio: 0.25 }); // PNG — preserves transparency
      const img = new Image();
      img.onload = () => {
        const cvs = document.createElement("canvas");
        cvs.width = img.width;
        cvs.height = img.height;
        const ctx = cvs.getContext("2d");
        if (!ctx) return;
        ctx.fillStyle = "#F8FAFC"; // slate-50 — matches canvas background
        ctx.fillRect(0, 0, cvs.width, cvs.height);
        ctx.drawImage(img, 0, 0);
        try {
          const dataUrl = cvs.toDataURL("image/jpeg", 0.65);
          localStorage.setItem(`collabboard-thumb-${boardId}`, dataUrl);
        } catch { /* storage full or unavailable */ }
      };
      img.src = rawUrl;
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

  // Selected lines' stroke width
  const selectedLines = selectedObjects.filter((o) => o.type === "line");
  const selectedStrokeWidth =
    selectedLines.length > 0 &&
    selectedLines.every((o) => (o.strokeWidth ?? 3) === (selectedLines[0].strokeWidth ?? 3))
      ? (selectedLines[0].strokeWidth ?? 3)
      : null;

  const handleChangeSelectedStrokeWidth = useCallback(
    (w: number) => {
      selection.selectedIds.forEach((id) => {
        const obj = objects[id];
        if (obj?.type === "line") updateObject(id, { strokeWidth: w });
      });
    },
    [selection.selectedIds, objects, updateObject]
  );

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
        activeStrokeWidth={activeStrokeWidth}
        selectedCount={selection.selectedIds.size}
        selectedColor={
          selection.selectedIds.size > 0
            ? (objects[Array.from(selection.selectedIds)[0]]?.color || "")
            : ""
        }
        selectedStrokeWidth={selectedStrokeWidth}
        onToolChange={setActiveTool}
        onColorChange={setActiveColor}
        onStrokeWidthChange={setActiveStrokeWidth}
        onChangeSelectedColor={handleChangeSelectedColor}
        onChangeSelectedStrokeWidth={handleChangeSelectedStrokeWidth}
      />

      {/* Left-side text style popup — only during text editing */}
      {editingObjectId && canEditSelectedText && (
        <TextStylePanel
          textSize={selectedTextSize}
          textColor={selectedTextColor}
          onIncreaseTextSize={() => handleAdjustSelectedTextSize(2)}
          onDecreaseTextSize={() => handleAdjustSelectedTextSize(-2)}
          onChangeTextColor={handleChangeSelectedTextColor}
        />
      )}

      {/* ── Top header bar ─────────────────────────────────── */}
      <div className="fixed top-0 left-0 right-0 z-50 h-11 bg-white/90 backdrop-blur-sm border-b border-gray-200 flex items-center px-3">
        {/* Left: dashboard button */}
        <div className="flex items-center gap-2 min-w-[140px]">
          <button
            onClick={() => { captureThumbnail(); onNavigateHome?.(); }}
            className="flex items-center gap-1.5 text-xs text-gray-500 hover:text-gray-800 transition px-2 py-1.5 rounded-lg hover:bg-gray-100"
            title="Back to Dashboard"
          >
            ← <span className="font-medium">Dashboard</span>
          </button>
        </div>

        {/* Center: board title (editable on click) */}
        <div className="flex-1 flex justify-center">
          <BoardTitleEditor title={boardTitle} onRename={updateBoardTitle} />
        </div>

        {/* Right: share, permissions, help */}
        <div className="flex items-center gap-1 min-w-[140px] justify-end">
          <ShareButton boardUrl={window.location.href} boardId={boardId} />
          <button
            className="px-2.5 py-1.5 rounded-lg text-xs text-gray-500 hover:text-gray-800 hover:bg-gray-100 transition flex items-center gap-1"
            title="Permissions (coming soon)"
            onClick={() => {/* future: open permissions modal */}}
          >
            <Shield size={14} />
          </button>
          <HelpPanel />
        </div>
      </div>

      {/* ── Online users — below header, top-left ────────── */}
      <div className="fixed top-12 left-3 z-40">
        <PresencePanel
          users={users}
          currentUserId={userId}
          boardUrl={window.location.href}
          boardId={boardId}
        />
      </div>

      {/* ── Zoom indicator — bottom-left ─────────────────── */}
      <div className="fixed bottom-4 left-4 z-50 bg-white/80 backdrop-blur rounded-lg px-3 py-1.5 text-xs text-gray-500 border border-gray-200 tabular-nums">
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
        activeStrokeWidth={activeStrokeWidth}
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
        onSetEditingObject={handleSetEditingObject}
        onDraftTextChange={setDraftText}
        getDraftTextForObject={getDraftTextForObject}
        isObjectLocked={isObjectLocked}
        onPushUndo={undoRedo.pushAction}
        onRotatingChange={setIsRotating}
        onResetTool={(selectId) => {
          if (selectId) {
            // Object just created — select it but stay in current tool mode.
            selection.clearSelection();
            selection.select(selectId);
          } else {
            // No ID = Escape pressed or explicit reset → return to select tool.
            setActiveTool("select");
          }
        }}
      />

      {/* AI Command Input */}
      <AICommandInput aiAgent={aiAgent} />

      {/* Rotation hint — above toolbar */}
      {isRotating && (
        <div className="fixed bottom-16 left-1/2 -translate-x-1/2 z-50 bg-gray-900/80 backdrop-blur text-white text-xs px-4 py-2 rounded-full pointer-events-none">
          Hold <kbd className="px-1.5 py-0.5 bg-white/20 rounded text-[11px] font-medium mx-0.5">Shift</kbd> while rotating to snap to 15° increments
        </div>
      )}
    </div>
  );
}
