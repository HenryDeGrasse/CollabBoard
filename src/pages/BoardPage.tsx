import { useState, useEffect, useCallback, useRef } from "react";
import type { BoardObject, Connector } from "../types/board";
import { Board, type ToolType } from "../components/canvas/Board";
import { Toolbar } from "../components/toolbar/Toolbar";
import { PresencePanel } from "../components/sidebar/PresencePanel";
import { AICommandInput, type AiSnapshot } from "../components/sidebar/AICommandInput";
import { TextStylePanel } from "../components/sidebar/TextStylePanel";
import { BoardSettingsPanel } from "../components/board/BoardSettingsPanel";
import { useBoard } from "../hooks/useBoard";
import { usePresence } from "../hooks/usePresence";
import { useCanvas } from "../hooks/useCanvas";
import { useSelection } from "../hooks/useSelection";
import { useUndoRedo } from "../hooks/useUndoRedo";
import { useBoardMembershipGuard } from "../hooks/useBoardMembershipGuard";
import { useAuth } from "../components/auth/AuthProvider";
import { HelpPanel } from "../components/ui/HelpPanel";
import { joinBoard, touchBoard, fetchBoardMetadata, requestBoardAccess } from "../services/board";
import { DEFAULT_STICKY_COLOR } from "../utils/colors";
import { Settings } from "lucide-react";
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
    updateObject,
    deleteObject,
    deleteFrameCascade,
    createConnector,
    updateConnector,
    deleteConnector,
    restoreObject,
    restoreObjects,
    restoreConnector,
    loading,
  } = useBoard(joined ? boardId : "");

  // objectsRef / connectorsRef are also declared further down for the keyboard
  // handler; those are the canonical declarations used by all closures.
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
      // Also update selected connectors
      selectedConnectorIds.forEach((id) => {
        updateConnector(id, { color });
      });
    },
    [selection.selectedIds, selectedConnectorIds, updateObject, updateConnector]
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

  type VAlign = "top" | "middle" | "bottom";
  const selectedTextVerticalAligns = textStyleTargets.map((o) => o.textVerticalAlign ?? "middle");
  const selectedTextVerticalAlign: VAlign =
    selectedTextVerticalAligns.length > 0 && selectedTextVerticalAligns.every((a) => a === selectedTextVerticalAligns[0])
      ? (selectedTextVerticalAligns[0] as VAlign)
      : "middle";

  const handleChangeTextVerticalAlign = useCallback(
    (align: VAlign) => {
      selection.selectedIds.forEach((id) => {
        const obj = objects[id];
        if (!obj || !isTextCapableObjectType(obj.type)) return;
        updateObject(id, { textVerticalAlign: align });
      });
    },
    [selection.selectedIds, objects, updateObject]
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
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-50 to-blue-50 px-4">
        <div className="bg-white rounded-2xl shadow-xl p-8 max-w-sm w-full text-center">
          <div className="text-4xl mb-4">🔒</div>
          <h1 className="text-xl font-bold text-gray-900 mb-2">This board is private</h1>
          <p className="text-gray-500 text-sm mb-4">
            Ask the board owner to share an invite link with you, or send an access request.
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
              className="w-full py-2.5 rounded-xl text-sm border border-emerald-200 text-emerald-700 bg-emerald-50 hover:bg-emerald-100 transition mb-3 disabled:opacity-60"
              disabled={requestingAccess || accessRequested}
            >
              {accessRequested
                ? "✓ Access request sent"
                : requestingAccess
                  ? "Sending request..."
                  : "Request Access"}
            </button>
          )}

          {accessRequestError && (
            <p className="text-xs text-red-600 mb-3">{accessRequestError}</p>
          )}

          <button
            onClick={() => onNavigateHome?.()}
            className="w-full py-3 rounded-xl text-white font-medium transition shadow-md hover:opacity-90"
            style={{ backgroundColor: "#0F2044" }}
          >
            Back to Dashboard
          </button>
        </div>
      </div>
    );
  }

  if (accessStatus === "not_found") {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-50 to-blue-50 px-4">
        <div className="bg-white rounded-2xl shadow-xl p-8 max-w-sm w-full text-center">
          <div className="text-4xl mb-4">🗂️</div>
          <h1 className="text-xl font-bold text-gray-900 mb-2">Board not found</h1>
          <p className="text-gray-500 text-sm mb-6">
            This board doesn't exist or may have been deleted.
          </p>
          <button
            onClick={() => onNavigateHome?.()}
            className="w-full py-3 rounded-xl text-white font-medium transition shadow-md hover:opacity-90"
            style={{ backgroundColor: "#0F2044" }}
          >
            Back to Dashboard
          </button>
        </div>
      </div>
    );
  }

  if (!joined || loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="flex items-center gap-3">
          <div className="animate-spin w-6 h-6 border-2 border-indigo-500 border-t-transparent rounded-full" />
          <span className="text-gray-600 font-medium">
            {!joined ? "Joining board…" : "Loading board…"}
          </span>
        </div>
      </div>
    );
  }

  const isBoardEmpty = Object.keys(objects).length === 0 && Object.keys(connectors).length === 0;

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
        selectedConnectorCount={selectedConnectorIds.size}
        selectedConnectorColor={selectedConnectorColor}
        selectedConnectorStrokeWidth={selectedConnectorStrokeWidth}
        onToolChange={setActiveTool}
        onColorChange={setActiveColor}
        onStrokeWidthChange={setActiveStrokeWidth}
        onChangeSelectedColor={handleChangeSelectedColor}
        onChangeSelectedStrokeWidth={handleChangeSelectedStrokeWidth}
        onChangeSelectedConnectorColor={handleChangeSelectedConnectorColor}
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

        {/* Right: settings, help */}
        <div className="flex items-center gap-1 min-w-[140px] justify-end">
          <button
            onClick={() => setShowSettings(true)}
            className="px-2.5 py-1.5 rounded-lg text-xs text-gray-500 hover:text-gray-800 hover:bg-gray-100 transition flex items-center gap-1.5"
            title="Share & Board Settings"
          >
            <Settings size={14} />
            <span className="font-medium">Share & Settings</span>
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

      {/* Empty-board quick start chips */}
      {isBoardEmpty && (
        <div className="fixed top-14 left-1/2 -translate-x-1/2 z-40 bg-white/90 backdrop-blur border border-gray-200 rounded-2xl shadow-sm px-3 py-2 flex items-center gap-2">
          <span className="text-xs text-gray-500 pr-1">Quick start:</span>
          {emptySuggestions.map((s) => (
            <button
              key={s.id}
              onClick={() => handleEmptySuggestion(s.id)}
              className="text-xs px-2.5 py-1 rounded-full border border-gray-200 bg-white text-gray-600 hover:border-emerald-300 hover:text-emerald-700 hover:bg-emerald-50 transition"
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
        />
      )}

      {/* Toast */}
      {toast && (
        <div
          className={`fixed bottom-6 left-1/2 -translate-x-1/2 z-50 flex items-center gap-3 px-5 py-3 rounded-xl shadow-lg text-sm font-medium text-white ${toast.type === "error" ? "bg-red-600" : "bg-slate-700"}`}
          style={{ animation: "toastIn 0.2s ease-out" }}
        >
          <span>{toast.message}</span>
          <button onClick={() => setToast(null)} className="ml-1 opacity-70 hover:opacity-100 transition leading-none">✕</button>
          <style>{`@keyframes toastIn { from { opacity:0; transform:translate(-50%,8px); } to { opacity:1; transform:translate(-50%,0); } }`}</style>
        </div>
      )}

      {/* Rotation hint — above toolbar */}
      {isRotating && (
        <div className="fixed bottom-16 left-1/2 -translate-x-1/2 z-50 bg-gray-900/80 backdrop-blur text-white text-xs px-4 py-2 rounded-full pointer-events-none">
          Hold <kbd className="px-1.5 py-0.5 bg-white/20 rounded text-[11px] font-medium mx-0.5">Shift</kbd> while rotating to snap to 15° increments
        </div>
      )}
    </div>
  );
}
