import React, { useState, useEffect, useCallback, useRef, useMemo } from "react";
import type { BoardObject, Connector } from "../types/board";
import type { ToolType } from "../types/tool";
import { Board } from "../components/canvas/Board";
import { Toolbar } from "../components/toolbar/Toolbar";
import { PresencePanel } from "../components/sidebar/PresencePanel";
import { AICommandInput, type AiSnapshot } from "../components/sidebar/AICommandInput";
import { TextStylePanel } from "../components/sidebar/TextStylePanel";
import { BoardSettingsPanel } from "../components/board/BoardSettingsPanel";
import { useBoard } from "../hooks/useBoard";
import { usePresence } from "../hooks/presence/usePresence";
import { useCanvas } from "../hooks/useCanvas";
import { useSelection } from "../hooks/useSelection";
import { useUndoRedo } from "../hooks/useUndoRedo";
import { useBoardMembershipGuard } from "../hooks/useBoardMembershipGuard";
import { useAuth } from "../components/auth/AuthProvider";
import { HelpPanel } from "../components/ui/HelpPanel";
import { touchBoard, fetchBoardMetadata } from "../services/board-crud";
import { joinBoard, requestBoardAccess } from "../services/board-access";
import { DEFAULT_STICKY_COLOR } from "../utils/colors";
import { Settings } from "lucide-react";
import { useKeyboardShortcuts } from "../hooks/useKeyboardShortcuts";
import { useThumbnailCapture } from "../hooks/useThumbnailCapture";
import { useTextStyleHandlers } from "../hooks/useTextStyleHandlers";

/* ─── Inline board-title editor ──────────────────────────────── */
const BoardTitleEditor = React.memo(function BoardTitleEditor({ title, onRename }: { title: string; onRename: (t: string) => void }) {
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
        className="text-newsprint-fg hover:text-newsprint-accent truncate max-w-[260px] px-2 py-1 sharp-corners transition-colors"
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
      className="text-newsprint-fg bg-transparent border-b-2 border-newsprint-fg sharp-corners px-2 py-1 outline-none focus-visible:bg-neutral-200 w-[220px] text-center uppercase"
      maxLength={60}
    />
  );
});

const EMPTY_BOARD_SUGGESTION_SETS = [
  [
    { id: "sticky", label: "Start with sticky notes" },
    { id: "ai_swot", label: "Ask AI: Create a SWOT board" },
    { id: "invite", label: "Invite collaborators" },
  ],
  [
    { id: "frame", label: "Create a frame" },
    { id: "ai_retro", label: "Ask AI: Set up a retro" },
    { id: "invite", label: "Share with your team" },
  ],
  [
    { id: "rectangle", label: "Sketch with shapes" },
    { id: "ai_brainstorm", label: "Ask AI: Generate brainstorm" },
    { id: "invite", label: "Manage access" },
  ],
] as const;

interface BoardPageProps {
  boardId: string;
  onNavigateHome?: () => void;
}

export function BoardPage({ boardId, onNavigateHome }: BoardPageProps) {
  const { user, session, displayName } = useAuth();
  const userId = user?.id || "";

  const [activeTool, setActiveTool] = useState<ToolType>("select");
  const [activeColor, setActiveColor] = useState<string>(DEFAULT_STICKY_COLOR);
  const [activeStrokeWidth, setActiveStrokeWidth] = useState<number>(3);
  const [isRotating, setIsRotating] = useState(false);
  const [selectedConnectorIds, setSelectedConnectorIds] = useState<Set<string>>(new Set());

  // Access control
  const [joined, setJoined] = useState(false);
  const [accessStatus, setAccessStatus] = useState<"loading" | "ok" | "private" | "not_found">("loading");
  const [myRole, setMyRole] = useState<"owner" | "editor">("editor");
  const [visibility, setVisibility] = useState<"public" | "private">("public");
  const [showSettings, setShowSettings] = useState(false);
  const [requestingAccess, setRequestingAccess] = useState(false);
  const [accessRequested, setAccessRequested] = useState(false);
  const [accessRequestError, setAccessRequestError] = useState<string | null>(null);
  const [toast, setToast] = useState<{ message: string; type: "error" | "info" } | null>(null);
  const isOwner = myRole === "owner";
  const [emptySuggestions, setEmptySuggestions] = useState<(typeof EMPTY_BOARD_SUGGESTION_SETS)[number]>(
    EMPTY_BOARD_SUGGESTION_SETS[0]
  );

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 2800);
    return () => clearTimeout(t);
  }, [toast]);

  useEffect(() => {
    // Pick a different set each time this board page mounts
    const idx = Math.floor(Math.random() * EMPTY_BOARD_SUGGESTION_SETS.length);
    setEmptySuggestions(EMPTY_BOARD_SUGGESTION_SETS[idx]);
  }, [boardId]);

  // Warm the AI serverless function the moment a board loads.
  // By the time the user types their first command the cold-start is already
  // paid — a health ping is cheap and fire-and-forget.
  useEffect(() => {
    if (!boardId) return;
    const apiBase = import.meta.env.VITE_API_URL ?? "";
    fetch(`${apiBase}/api/health`).catch(() => {});
  }, [boardId]);

  // Ensure user is a member of this board BEFORE loading data.
  // RLS policies require board_members entry for SELECT on objects/connectors.
  useEffect(() => {
    if (!boardId || !userId) return;
    let cancelled = false;

    joinBoard(boardId, userId)
      .then(async (result) => {
        if (cancelled) return;
        if (result.status === "not_found") { setAccessStatus("not_found"); return; }
        if (result.status === "private")   { setAccessStatus("private");   return; }
        // "member" or "joined" — we're in
        setMyRole(result.status === "member" ? result.role : "editor");
        // Fetch visibility so settings panel starts correctly
        const meta = await fetchBoardMetadata(boardId);
        if (!cancelled && meta) setVisibility(meta.visibility);
        if (!cancelled) { setAccessStatus("ok"); setJoined(true); touchBoard(boardId); }
      })
      .catch((err) => {
        console.error("Failed to join board:", err);
        if (!cancelled) { setAccessStatus("ok"); setJoined(true); }
      });

    return () => { cancelled = true; };
  }, [boardId, userId]);

  useBoardMembershipGuard({
    boardId,
    userId,
    onRemoved: () => {
      localStorage.setItem(
        "collabboard_toast",
        JSON.stringify({
          type: "info",
          message: "You've been removed from this board by the owner.",
        })
      );
      onNavigateHome?.();
    },
  });

  const {
    objects,
    connectors,
    boardTitle,
    updateBoardTitle,
    createObject,
    createObjects,
    updateObject,
    deleteObject,
    deleteFrameCascade,
    createConnector,
    updateConnector,
    deleteConnector,
    restoreObject,
    restoreObjects,
    restoreConnector,
    setIdRemapCallback,
    setPersistenceErrorCallback,
    loading,
  } = useBoard(joined ? boardId : "");

  // objectsRef / connectorsRef are also declared further down for the keyboard
  // handler; those are the canonical declarations used by all closures.
  const {
    users,
    cursorStore,
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
  const [editingObjectId, setEditingObjectId] = useState<string | null>(null);

  // Wrap presence setEditingObject to also track locally for TextStylePanel visibility
  const handleSetEditingObject = useCallback((objectId: string | null) => {
    setEditingObjectId(objectId);
    setEditingObject(objectId);
  }, [setEditingObject]);

  // ── Thumbnail capture ────────────────────────────────────────
  const { captureThumbnail } = useThumbnailCapture(boardId, canvas.stageRef);
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

  // Wire up persistence error reporting to the toast system so failed DB
  // writes are surfaced to the user instead of silently swallowed.
  useEffect(() => {
    setPersistenceErrorCallback((message) => {
      setToast({ message, type: "error" });
    });
    return () => setPersistenceErrorCallback(null);
  }, [setPersistenceErrorCallback]);

  // When createObject's temp ID is replaced by the real DB ID, update selection
  // so duplicated/pasted objects stay selected.
  useEffect(() => {
    setIdRemapCallback((tempId, realId) => {
      const sel = selectionRef.current;
      if (sel.selectedIds.has(tempId)) {
        sel.selectMultiple(
          Array.from(sel.selectedIds).map((id) => (id === tempId ? realId : id))
        );
      }
    });
    return () => setIdRemapCallback(null);
  }, [setIdRemapCallback]);

  // Expose board functions for E2E testing
  useEffect(() => {
    (window as any).__COLLABBOARD__ = {
      boardId,
      userId,
      createObject,
      createObjects,
      objects,
      connectors,
      // Returns a snapshot of all remote cursor positions keyed by userId.
      // Used by E2E latency tests to detect when a remote cursor update arrives.
      getCursorPositions: () => cursorStore.get(),
      // Exposes the Konva Stage for E2E tests that need to hook into batchDraw
      // to measure actual canvas draw rate (not just rAF invocation rate).
      getStage: () => canvas.stageRef.current,
    };
    return () => { delete (window as any).__COLLABBOARD__; };
  }, [boardId, userId, createObject, createObjects, objects, connectors, cursorStore, canvas.stageRef]);

  // (join handled above, before useBoard initialization)

  // Keyboard shortcuts for tools + undo/redo + copy/paste/duplicate
  useKeyboardShortcuts({
    undoRedo,
    createObject,
    createConnector,
    updateObject,
    userId,
    clipboardRef,
    objectsRef,
    connectorsRef,
    selectionRef,
    canvas,
    onToolChange: setActiveTool,
  });

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
      // Also update selected connectors
      selectedConnectorIds.forEach((id) => {
        updateConnector(id, { color });
      });
    },
    [selection.selectedIds, selectedConnectorIds, updateObject, updateConnector]
  );

  const selectedObjects = useMemo(() =>
    Array.from(selection.selectedIds)
      .map((id) => objects[id])
      .filter(Boolean) as BoardObject[],
    [selection.selectedIds, objects]
  );

  // Memoize so Toolbar doesn't re-render on every objects change
  const selectedColor = useMemo(() => {
    const first = selection.selectedIds.values().next();
    if (first.done) return "";
    return objects[first.value]?.color || "";
  }, [selection.selectedIds, objects]);

  const {
    canEditSelectedText,
    selectedTextSize,
    selectedTextColor,
    selectedTextVerticalAlign,
    handleAdjustSelectedTextSize,
    handleChangeSelectedTextColor,
    handleChangeTextVerticalAlign,
  } = useTextStyleHandlers({
    selectedIds: selection.selectedIds,
    objects,
    updateObject,
  });

  // Selected lines' stroke width
  const selectedLines = selectedObjects.filter((o) => o.type === "line");
  const selectedStrokeWidth =
    selectedLines.length > 0 &&
    selectedLines.every((o) => (o.strokeWidth ?? 3) === (selectedLines[0].strokeWidth ?? 3))
      ? (selectedLines[0].strokeWidth ?? 3)
      : null;

  const handleChangeSelectedStrokeWidth = useCallback(
    (w: number) => {
      // Update legacy line objects
      selection.selectedIds.forEach((id) => {
        const obj = objects[id];
        if (obj?.type === "line") updateObject(id, { strokeWidth: w });
      });
      // Update selected connectors
      selectedConnectorIds.forEach((id) => {
        updateConnector(id, { strokeWidth: w });
      });
    },
    [selection.selectedIds, selectedConnectorIds, objects, updateObject, updateConnector]
  );

  // Selected connectors style info
  const selectedConnectors = Array.from(selectedConnectorIds)
    .map((id) => connectors[id])
    .filter(Boolean);
  const selectedConnectorColor =
    selectedConnectors.length > 0 &&
    selectedConnectors.every((c) => (c.color ?? "#4B5563") === (selectedConnectors[0].color ?? "#4B5563"))
      ? (selectedConnectors[0].color ?? "#4B5563")
      : null;
  const selectedConnectorStrokeWidth =
    selectedConnectors.length > 0 &&
    selectedConnectors.every((c) => (c.strokeWidth ?? 2.5) === (selectedConnectors[0].strokeWidth ?? 2.5))
      ? (selectedConnectors[0].strokeWidth ?? 2.5)
      : null;

  const handleChangeSelectedConnectorColor = useCallback(
    (color: string) => {
      selectedConnectorIds.forEach((id) => {
        updateConnector(id, { color });
      });
    },
    [selectedConnectorIds, updateConnector]
  );


  const handleEmptySuggestion = useCallback((id: string) => {
    switch (id) {
      case "sticky":
        setActiveTool("sticky");
        break;
      case "frame":
        setActiveTool("frame");
        break;
      case "rectangle":
        setActiveTool("rectangle");
        break;
      case "invite":
        setShowSettings(true);
        break;
      case "ai_swot":
        window.dispatchEvent(new CustomEvent("collabboard:ai-prefill", {
          detail: { command: "Create a SWOT analysis template" },
        }));
        break;
      case "ai_retro":
        window.dispatchEvent(new CustomEvent("collabboard:ai-prefill", {
          detail: { command: "Set up a retrospective board with columns for Went well, To improve, and Action items" },
        }));
        break;
      case "ai_brainstorm":
        window.dispatchEvent(new CustomEvent("collabboard:ai-prefill", {
          detail: { command: "Create a brainstorm board with 8 sticky notes grouped by themes" },
        }));
        break;
      default:
        break;
    }
  }, []);

  // ── Access-denied / not-found screens ────────────────────────
  if (accessStatus === "private") {
    return (
      <div className="min-h-screen flex items-center justify-center bg-newsprint-bg newsprint-texture px-4">
        <div className="bg-newsprint-bg border-2 border-newsprint-fg sharp-corners shadow-[8px_8px_0px_0px_#111111] p-8 max-w-sm w-full text-center">
          <div className="text-4xl mb-6">🔒</div>
          <h1 className="text-2xl font-black font-serif text-newsprint-fg mb-4 uppercase tracking-widest">Private Board</h1>
          <p className="text-newsprint-fg font-body text-sm mb-8 leading-relaxed">
            Request clearance from the editor-in-chief to access this board.
          </p>

          {session?.access_token && (
            <button
              onClick={async () => {
                if (requestingAccess || accessRequested) return;
                setRequestingAccess(true);
                setAccessRequestError(null);
                try {
                  await requestBoardAccess(boardId, session.access_token);
                  setAccessRequested(true);
                } catch (e: any) {
                  console.error("Failed to request access:", e);
                  setAccessRequestError(e?.message ?? "Could not send request");
                } finally {
                  setRequestingAccess(false);
                }
              }}
              className="w-full py-3 sharp-corners text-xs font-mono uppercase tracking-widest font-bold border border-newsprint-fg text-newsprint-fg hover:bg-neutral-200 transition-colors mb-4 disabled:opacity-60 disabled:cursor-not-allowed"
              disabled={requestingAccess || accessRequested}
            >
              {accessRequested
                ? "✓ Clearance Requested"
                : requestingAccess
                  ? "Transmitting..."
                  : "Request Clearance"}
            </button>
          )}

          {accessRequestError && (
            <p className="text-xs text-newsprint-accent font-mono uppercase tracking-widest mb-4">{accessRequestError}</p>
          )}

          <button
            onClick={() => onNavigateHome?.()}
            className="w-full py-3 sharp-corners text-xs font-mono uppercase tracking-widest font-bold bg-newsprint-fg text-newsprint-bg border border-transparent hover:bg-white hover:text-newsprint-fg hover:border-newsprint-fg transition-colors"
          >
            Back to Dashboard
          </button>
        </div>
      </div>
    );
  }

  if (accessStatus === "not_found") {
    return (
      <div className="min-h-screen flex items-center justify-center bg-newsprint-bg newsprint-texture px-4">
        <div className="bg-newsprint-bg border-2 border-newsprint-fg sharp-corners shadow-[8px_8px_0px_0px_#111111] p-8 max-w-sm w-full text-center">
          <div className="text-4xl mb-6">🗂️</div>
          <h1 className="text-2xl font-black font-serif text-newsprint-fg mb-4 uppercase tracking-widest">Board Not Found</h1>
          <p className="text-newsprint-fg font-body text-sm mb-8 leading-relaxed">
            This board doesn't exist or may have been deleted.
          </p>
          <button
            onClick={() => onNavigateHome?.()}
            className="w-full py-3 sharp-corners text-xs font-mono uppercase tracking-widest font-bold bg-newsprint-fg text-newsprint-bg border border-transparent hover:bg-white hover:text-newsprint-fg hover:border-newsprint-fg transition-colors"
          >
            Back to Dashboard
          </button>
        </div>
      </div>
    );
  }

  if (!joined || loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-newsprint-bg newsprint-texture">
        <div className="flex items-center gap-4">
          <div className="animate-spin w-8 h-8 border-4 border-newsprint-muted border-t-newsprint-fg rounded-full" />
          <span className="text-newsprint-fg font-mono uppercase tracking-widest font-bold text-sm">
            {!joined ? "Joining board…" : "Loading board…"}
          </span>
        </div>
      </div>
    );
  }

  const isBoardEmpty = Object.keys(objects).length === 0 && Object.keys(connectors).length === 0;

  return (
    <div className="w-screen h-screen overflow-hidden bg-newsprint-bg newsprint-texture">
      {/* Toolbar */}
      <Toolbar
        activeTool={activeTool}
        activeColor={activeColor}
        activeStrokeWidth={activeStrokeWidth}
        selectedCount={selection.selectedIds.size}
        selectedColor={selectedColor}
        selectedStrokeWidth={selectedStrokeWidth}
        selectedConnectorCount={selectedConnectorIds.size}
        selectedConnectorColor={selectedConnectorColor}
        selectedConnectorStrokeWidth={selectedConnectorStrokeWidth}
        onToolChange={setActiveTool}
        onColorChange={setActiveColor}
        onStrokeWidthChange={setActiveStrokeWidth}
        onChangeSelectedColor={handleChangeSelectedColor}
        onChangeSelectedStrokeWidth={handleChangeSelectedStrokeWidth}
        onChangeSelectedConnectorColor={handleChangeSelectedConnectorColor}
        stageRef={canvas.stageRef}
        objectsRef={objectsRef}
        connectorsRef={connectorsRef}
        boardTitle={boardTitle}
      />

      {/* Left-side text style popup — only during text editing */}
      {editingObjectId && canEditSelectedText && (
        <TextStylePanel
          textSize={selectedTextSize}
          textColor={selectedTextColor}
          textVerticalAlign={selectedTextVerticalAlign}
          onIncreaseTextSize={() => handleAdjustSelectedTextSize(2)}
          onDecreaseTextSize={() => handleAdjustSelectedTextSize(-2)}
          onChangeTextColor={handleChangeSelectedTextColor}
          onChangeTextVerticalAlign={handleChangeTextVerticalAlign}
        />
      )}

      {/* ── Top header bar ─────────────────────────────────── */}
      <div className="fixed top-0 left-0 right-0 z-50 h-12 bg-newsprint-bg border-b-2 border-newsprint-fg flex items-center px-4">
        {/* Left: dashboard button */}
        <div className="flex items-center gap-2 min-w-[140px]">
          <button
            onClick={() => { captureThumbnail(); onNavigateHome?.(); }}
            className="flex items-center gap-2 text-[10px] font-mono font-bold uppercase tracking-widest text-newsprint-fg hover:bg-neutral-200 transition-colors px-3 py-1.5 sharp-corners border border-transparent hover:border-newsprint-fg"
            title="Back to Dashboard"
          >
            ← <span>Dashboard</span>
          </button>
        </div>

        {/* Center: board title (editable on click) */}
        <div className="flex-1 flex justify-center font-serif text-lg font-bold uppercase">
          <BoardTitleEditor title={boardTitle} onRename={updateBoardTitle} />
        </div>

        {/* Right: settings, help */}
        <div className="flex items-center gap-2 min-w-[140px] justify-end">
          <button
            onClick={() => setShowSettings(true)}
            className="px-3 py-1.5 sharp-corners text-[10px] font-mono font-bold uppercase tracking-widest text-newsprint-fg hover:bg-neutral-200 transition-colors flex items-center gap-2 border border-transparent hover:border-newsprint-fg"
            title="Share & Board Settings"
          >
            <Settings size={14} strokeWidth={1.5} />
            <span>Settings</span>
          </button>
          <HelpPanel />
        </div>
      </div>

      {/* ── Online users — below header, top-left ────────── */}
      <div className="fixed top-12 left-3 z-40">
        <PresencePanel
          users={users}
          currentUserId={userId}
        />
      </div>

      {/* Zoom indicator — bottom-left */}
      <div className="fixed bottom-4 left-4 z-50 bg-newsprint-bg border border-newsprint-fg sharp-corners px-3 py-1.5 text-[10px] font-mono font-bold uppercase tracking-widest text-newsprint-fg shadow-[2px_2px_0px_0px_#111111] tabular-nums">
        {Math.round(canvas.viewport.scale * 100)}%
      </div>

      {/* Empty-board quick start chips */}
      {isBoardEmpty && (
        <div className="fixed top-16 left-1/2 -translate-x-1/2 z-40 bg-newsprint-bg border-2 border-newsprint-fg sharp-corners shadow-[4px_4px_0px_0px_#111111] px-4 py-3 flex items-center gap-3">
          <span className="text-[10px] font-mono font-bold uppercase tracking-widest text-newsprint-fg pr-2 border-r border-newsprint-muted">Actions</span>
          {emptySuggestions.map((s) => (
            <button
              key={s.id}
              onClick={() => handleEmptySuggestion(s.id)}
              className="text-[10px] font-mono font-bold uppercase tracking-widest px-3 py-1.5 sharp-corners border border-newsprint-fg bg-transparent text-newsprint-fg hover:bg-newsprint-fg hover:text-newsprint-bg transition-colors"
            >
              {s.label}
            </button>
          ))}
        </div>
      )}

      {/* Main canvas */}
      <Board
        objects={objects}
        connectors={connectors}
        users={users}
        cursorStore={cursorStore}
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
        onUpdateConnector={updateConnector}
        onDeleteConnector={deleteConnector}
        onSelectedConnectorsChange={setSelectedConnectorIds}
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
            // Object just created — don't select it (no handles flicker)
            // Just clear any existing selection.
            selection.clearSelection();
          } else {
            // No ID = Escape pressed or explicit reset → return to select tool.
            setActiveTool("select");
          }
        }}
      />

      {/* AI Command Input */}
      <AICommandInput
        boardId={boardId}
        viewport={canvas.viewport}
        selectedIds={Array.from(selection.selectedIds)}
        onNavigate={canvas.setViewport}
        captureSnapshot={() => ({
          objects:    { ...objectsRef.current },
          connectors: { ...connectorsRef.current },
        })}
        onUndoSnapshot={(snapshot: AiSnapshot) => {
          const snap = snapshot as {
            objects:    Record<string, BoardObject>;
            connectors: Record<string, Connector>;
          };
          // Delete objects that the AI created (present now, absent in snapshot)
          Object.keys(objectsRef.current).forEach((id) => {
            if (!snap.objects[id]) deleteObject(id);
          });
          // Restore objects that existed before (handles updates + deletes by AI)
          const objsToRestore = Object.values(snap.objects);
          if (objsToRestore.length > 0) restoreObjects(objsToRestore);
          // Delete connectors the AI created
          Object.keys(connectorsRef.current).forEach((id) => {
            if (!snap.connectors[id]) deleteConnector(id);
          });
          // Restore connectors that existed before
          Object.values(snap.connectors).forEach((conn) => restoreConnector(conn));
          setToast({ message: "AI changes undone.", type: "info" });
        }}
      />

      {/* Board settings / share panel */}
      {showSettings && (
        <BoardSettingsPanel
          boardId={boardId}
          isOwner={isOwner}
          visibility={visibility}
          onVisibilityChange={setVisibility}
          onClose={() => setShowSettings(false)}
          onToast={(message, type = "info") => setToast({ message, type })}
          onSelfRemoved={() => {
            localStorage.setItem(
              "collabboard_toast",
              JSON.stringify({ type: "info", message: "You've left the board." })
            );
            onNavigateHome?.();
          }}
        />
      )}

      {/* Toast */}
      {toast && (
        <div
          className={`fixed bottom-8 left-1/2 -translate-x-1/2 z-50 flex items-center gap-4 px-6 py-4 sharp-corners border-2 shadow-[4px_4px_0px_0px_#111111] text-sm font-mono uppercase tracking-widest font-bold ${toast.type === "error" ? "bg-newsprint-accent text-white border-newsprint-fg" : "bg-newsprint-bg text-newsprint-fg border-newsprint-fg"}`}
          style={{ animation: "toastIn 0.2s ease-out" }}
        >
          <span>{toast.message}</span>
          <button onClick={() => setToast(null)} className="ml-2 opacity-70 hover:opacity-100 transition leading-none text-lg border border-transparent hover:border-current px-1">✕</button>
          <style>{`@keyframes toastIn { from { opacity:0; transform:translate(-50%,8px); } to { opacity:1; transform:translate(-50%,0); } }`}</style>
        </div>
      )}

      {/* Rotation hint — above toolbar */}
      {isRotating && (
        <div className="fixed bottom-20 left-1/2 -translate-x-1/2 z-50 bg-newsprint-fg text-newsprint-bg text-[10px] font-mono uppercase tracking-widest font-bold px-4 py-2 sharp-corners pointer-events-none shadow-[4px_4px_0px_0px_rgba(0,0,0,0.5)]">
          Hold <kbd className="px-1.5 py-0.5 border border-newsprint-bg text-newsprint-bg mx-0.5 sharp-corners">Shift</kbd> to snap
        </div>
      )}
    </div>
  );
}
