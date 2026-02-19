import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { createPortal } from "react-dom";
import { useAuth } from "../components/auth/AuthProvider";
import {
  getUserBoards,
  createBoard,
  joinBoard,
  softDeleteBoard,
  removeBoardMember,
  getInviteToken,
  type BoardMetadata,
} from "../services/board";
import {
  Plus,
  LogOut,
  Search,
  Clock,
  Users,
  Trash2,
  ExternalLink,
  LayoutGrid,
  List,
  MoreHorizontal,
  Link2,
  Copy,
  Globe,
  Lock,
} from "lucide-react";

// Inline logo matching the login page — two cursor arrows (navy + mint)
function CollabBoardLogo({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none" aria-hidden>
      <path d="M3 3L3 21L13 15L3 3Z"   fill="#0F2044" stroke="white" strokeWidth="1.5" strokeLinejoin="round" />
      <path d="M11 9L11 27L21 21L11 9Z" fill="#10B981" stroke="white" strokeWidth="1.5" strokeLinejoin="round" />
    </svg>
  );
}

interface HomePageProps {
  onNavigateToBoard: (boardId: string) => void;
}

type ViewMode = "grid" | "list";

export function HomePage({ onNavigateToBoard }: HomePageProps) {
  const { user, session, displayName, signOut } = useAuth();
  const userId = user?.id || "";
  const [boards, setBoards] = useState<BoardMetadata[]>([]);
  const [loading, setLoading] = useState(true);
  const [joinBoardId, setJoinBoardId] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [viewMode, setViewMode] = useState<ViewMode>("grid");
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newBoardTitle, setNewBoardTitle] = useState("");
  const [newBoardVisibility, setNewBoardVisibility] = useState<"public" | "private">("public");
  const [pendingBoardAction, setPendingBoardAction] = useState<{ boardId: string; isOwner: boolean } | null>(null);
  const [toast, setToast] = useState<{ message: string; type: "error" | "info" } | null>(null);

  // One-time toast passed via localStorage (e.g., removed from board)
  useEffect(() => {
    const raw = localStorage.getItem("collabboard_toast");
    if (!raw) return;
    localStorage.removeItem("collabboard_toast");
    try {
      const parsed = JSON.parse(raw) as { message?: string; type?: "error" | "info" };
      if (parsed?.message) {
        setToast({ message: parsed.message, type: parsed.type ?? "info" });
      }
    } catch {
      // ignore malformed payload
    }
  }, []);

  // Auto-dismiss toast after 3 s
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3000);
    return () => clearTimeout(t);
  }, [toast]);

  // Load user's boards
  useEffect(() => {
    if (!userId) return;

    const loadBoards = async () => {
      setLoading(true);
      try {
        const userBoards = await getUserBoards(userId);
        setBoards(userBoards);
      } catch (err) {
        console.error("Failed to load boards:", err);
      }
      setLoading(false);
    };

    loadBoards();
  }, [userId]);

  // Filter and sort boards
  const filteredBoards = useMemo(() => {
    return boards
      .filter((meta) => {
        if (searchQuery) {
          return meta.title.toLowerCase().includes(searchQuery.toLowerCase());
        }
        return true;
      })
      .sort((a, b) => b.updatedAt - a.updatedAt);
  }, [boards, searchQuery]);

  const myBoards = useMemo(
    () => filteredBoards.filter((meta) => meta.ownerId === userId),
    [filteredBoards, userId]
  );

  const sharedBoards = useMemo(
    () => filteredBoards.filter((meta) => meta.ownerId !== userId),
    [filteredBoards, userId]
  );

  const handleCreateBoard = useCallback(async () => {
    if (!userId) return;
    const title = newBoardTitle.trim() || "Untitled Board";
    try {
      const boardId = await createBoard(title, userId, newBoardVisibility);
      setShowCreateModal(false);
      setNewBoardTitle("");
      setNewBoardVisibility("public");
      onNavigateToBoard(boardId);
    } catch (err) {
      console.error("Failed to create board:", err);
    }
  }, [newBoardTitle, newBoardVisibility, userId, onNavigateToBoard]);

  const handleJoinBoard = useCallback(async () => {
    const id = joinBoardId.trim();
    if (!id || !userId) return;
    try {
      const result = await joinBoard(id, userId);
      if (result.status === "not_found") {
        setToast({ message: "Board not found — double-check the ID and try again.", type: "error" });
        return;
      }
      if (result.status === "private") {
        // Navigate to the board's private access screen so the user can request access.
        onNavigateToBoard(id);
        return;
      }
      onNavigateToBoard(id);
    } catch (err) {
      setToast({ message: "Something went wrong — please try again.", type: "error" });
      console.error("Failed to join board:", err);
    }
  }, [joinBoardId, userId, onNavigateToBoard]);

  const handleDeleteBoard = useCallback(async (boardId: string) => {
    try {
      await softDeleteBoard(boardId);
      setBoards((prev) => prev.filter((b) => b.id !== boardId));
      localStorage.removeItem(`collabboard-thumb-${boardId}`); // clean up thumbnail
      setToast({ message: "Board removed.", type: "info" });
    } catch (err) {
      console.error("Failed to delete board:", err);
    }
    setPendingBoardAction(null);
  }, []);

  const handleLeaveBoard = useCallback(async (boardId: string) => {
    if (!userId || !session?.access_token) return;
    try {
      await removeBoardMember(boardId, userId, session.access_token);
      setBoards((prev) => prev.filter((b) => b.id !== boardId));
      localStorage.removeItem(`collabboard-thumb-${boardId}`);
      setToast({ message: "You left the board.", type: "info" });
    } catch (err) {
      console.error("Failed to leave board:", err);
      setToast({ message: "Couldn't leave board. Please try again.", type: "error" });
    }
    setPendingBoardAction(null);
  }, [userId, session?.access_token]);

  const handleCopyInvite = useCallback(async (boardId: string) => {
    if (!session?.access_token) return;
    try {
      const token = await getInviteToken(boardId, session.access_token);
      const url = `${window.location.origin}/invite/${token}`;
      await navigator.clipboard.writeText(url);
      setToast({ message: "Invite link copied to clipboard.", type: "info" });
    } catch (err) {
      console.error("Failed to copy invite link:", err);
      setToast({ message: "Couldn't copy invite link. Try again.", type: "error" });
    }
  }, [session?.access_token]);

  const handleCopyBoardId = useCallback(async (boardId: string) => {
    try {
      await navigator.clipboard.writeText(boardId);
      setToast({ message: "Board ID copied to clipboard.", type: "info" });
    } catch (err) {
      console.error("Failed to copy board ID:", err);
      setToast({ message: "Couldn't copy board ID.", type: "error" });
    }
  }, []);

  const formatDate = (timestamp: number) => {
    const date = new Date(timestamp);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return "Just now";
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;
    return date.toLocaleDateString();
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-blue-50">
      {/* Header */}
      <header className="bg-white/80 backdrop-blur-sm border-b border-gray-200 sticky top-0 z-20">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 flex items-center justify-between">
          <h1 className="text-2xl font-bold flex items-center gap-2.5" style={{ color: "#0F2044" }}>
            <CollabBoardLogo size={28} />
            CollabBoard
          </h1>
          <div className="flex items-center gap-4">
            <span className="text-sm text-gray-500">
              Hello, <span className="font-medium text-gray-700">{displayName}</span>
            </span>
            <button
              onClick={signOut}
              className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition"
            >
              <LogOut size={14} />
              Sign out
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Action bar */}
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 mb-8">
          <div className="flex items-center gap-3 flex-1 w-full sm:w-auto">
            <div className="relative flex-1 max-w-md">
              <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search boards..."
                className="w-full pl-9 pr-4 py-2.5 bg-white border border-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-emerald-400 focus:border-transparent outline-none transition shadow-sm"
              />
            </div>
            <div className="flex items-center bg-white border border-gray-200 rounded-lg overflow-hidden shadow-sm">
              <button
                onClick={() => setViewMode("grid")}
                className={`p-2 transition ${viewMode === "grid" ? "text-white" : "text-gray-400 hover:text-gray-600"}`}
                style={viewMode === "grid" ? { backgroundColor: "#0F2044" } : {}}
              >
                <LayoutGrid size={16} />
              </button>
              <button
                onClick={() => setViewMode("list")}
                className={`p-2 transition ${viewMode === "list" ? "text-white" : "text-gray-400 hover:text-gray-600"}`}
                style={viewMode === "list" ? { backgroundColor: "#0F2044" } : {}}
              >
                <List size={16} />
              </button>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <div className="flex gap-2">
              <input
                id="join-board-id"
                name="boardId"
                type="text"
                value={joinBoardId}
                onChange={(e) => setJoinBoardId(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleJoinBoard()}
                placeholder="Board ID"
                className="w-32 px-3 py-2.5 bg-white border border-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-emerald-400 focus:border-transparent outline-none transition shadow-sm"
              />
              <button onClick={handleJoinBoard} disabled={!joinBoardId.trim()} className="px-4 py-2.5 text-white rounded-xl text-sm font-medium transition disabled:opacity-50 shadow-sm" style={{ backgroundColor: "#0F2044" }} onMouseEnter={e => (e.currentTarget.style.opacity="0.85")} onMouseLeave={e => (e.currentTarget.style.opacity="1")}>
                Join
              </button>
            </div>
            <button onClick={() => setShowCreateModal(true)} className="flex items-center gap-2 px-5 py-2.5 text-white rounded-xl text-sm font-medium transition shadow-md hover:shadow-lg" style={{ backgroundColor: "#0F2044" }} onMouseEnter={e => (e.currentTarget.style.opacity="0.85")} onMouseLeave={e => (e.currentTarget.style.opacity="1")}>
              <Plus size={16} />
              New Board
            </button>
          </div>
        </div>

        {loading && (
          <div className="flex items-center justify-center py-20">
            <div className="animate-spin w-8 h-8 border-4 border-slate-200 border-t-[#0F2044] rounded-full" />
          </div>
        )}

        {!loading && filteredBoards.length === 0 && !searchQuery && (
          <div className="text-center py-20">
            <div className="w-16 h-16 rounded-2xl flex items-center justify-center mx-auto mb-4" style={{ backgroundColor: "rgba(15,32,68,0.06)" }}>
              <CollabBoardLogo size={34} />
            </div>
            <h2 className="text-xl font-semibold mb-2" style={{ color: "#0F2044" }}>No boards yet</h2>
            <p className="text-gray-500 mb-6">Create your first collaborative whiteboard to get started.</p>
            <button onClick={() => setShowCreateModal(true)} className="inline-flex items-center gap-2 px-6 py-3 text-white rounded-xl font-medium transition shadow-md" style={{ backgroundColor: "#0F2044" }} onMouseEnter={e => (e.currentTarget.style.opacity="0.85")} onMouseLeave={e => (e.currentTarget.style.opacity="1")}>
              <Plus size={18} />
              Create Your First Board
            </button>
          </div>
        )}

        {!loading && filteredBoards.length === 0 && searchQuery && (
          <div className="text-center py-20">
            <p className="text-gray-500">No boards matching &quot;{searchQuery}&quot;</p>
          </div>
        )}

        {myBoards.length > 0 && (
          <section className="mb-10">
            <h2 className="text-sm font-semibold uppercase tracking-wider text-gray-400 mb-4">My Boards ({myBoards.length})</h2>
            <div className={viewMode === "grid" ? "grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4" : "space-y-2"}>
              {myBoards.map((meta) => (
                viewMode === "grid" ? (
                  <BoardCard key={meta.id} meta={meta} isOwner
                    onOpen={() => onNavigateToBoard(meta.id)}
                    onDelete={() => setPendingBoardAction({ boardId: meta.id, isOwner: true })}
                    onCopyInvite={() => handleCopyInvite(meta.id)}
                    onCopyBoardId={() => handleCopyBoardId(meta.id)}
                    formatDate={formatDate} />
                ) : (
                  <BoardRow key={meta.id} meta={meta} isOwner
                    onOpen={() => onNavigateToBoard(meta.id)}
                    onDelete={() => setPendingBoardAction({ boardId: meta.id, isOwner: true })}
                    onCopyInvite={() => handleCopyInvite(meta.id)}
                    onCopyBoardId={() => handleCopyBoardId(meta.id)}
                    formatDate={formatDate} />
                )
              ))}
            </div>
          </section>
        )}

        {sharedBoards.length > 0 && (
          <section className="mb-10">
            <h2 className="text-sm font-semibold uppercase tracking-wider text-gray-400 mb-4">Shared with Me ({sharedBoards.length})</h2>
            <div className={viewMode === "grid" ? "grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4" : "space-y-2"}>
              {sharedBoards.map((meta) => (
                viewMode === "grid" ? (
                  <BoardCard key={meta.id} meta={meta} isOwner={false}
                    onOpen={() => onNavigateToBoard(meta.id)}
                    onDelete={() => setPendingBoardAction({ boardId: meta.id, isOwner: false })}
                    onCopyBoardId={() => handleCopyBoardId(meta.id)}
                    formatDate={formatDate} />
                ) : (
                  <BoardRow key={meta.id} meta={meta} isOwner={false}
                    onOpen={() => onNavigateToBoard(meta.id)}
                    onDelete={() => setPendingBoardAction({ boardId: meta.id, isOwner: false })}
                    onCopyBoardId={() => handleCopyBoardId(meta.id)}
                    formatDate={formatDate} />
                )
              ))}
            </div>
          </section>
        )}
      </main>

      {/* Create Board Modal */}
      {showCreateModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm" onClick={() => setShowCreateModal(false)}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm mx-4 p-6" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-lg font-semibold text-gray-900 mb-4">Create New Board</h2>
            <input
              autoFocus
              type="text"
              value={newBoardTitle}
              onChange={(e) => setNewBoardTitle(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleCreateBoard()}
              placeholder="Board title (optional)"
              className="w-full px-4 py-3 border border-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-emerald-400 focus:border-transparent outline-none transition mb-4"
            />

            {/* Visibility picker */}
            <div className="flex gap-2 mb-5">
              <button
                onClick={() => setNewBoardVisibility("public")}
                className={`flex-1 flex items-center gap-2 px-3 py-2.5 rounded-xl border-2 text-sm transition ${
                  newBoardVisibility === "public"
                    ? "border-emerald-400 bg-emerald-50 text-emerald-700"
                    : "border-gray-200 text-gray-500 hover:border-gray-300"
                }`}
              >
                <Globe size={14} className="shrink-0" />
                <div className="text-left">
                  <div className="font-medium text-xs">Public</div>
                  <div className="text-[10px] opacity-70">Anyone with link</div>
                </div>
              </button>
              <button
                onClick={() => setNewBoardVisibility("private")}
                className={`flex-1 flex items-center gap-2 px-3 py-2.5 rounded-xl border-2 text-sm transition ${
                  newBoardVisibility === "private"
                    ? "border-indigo-400 bg-indigo-50 text-indigo-700"
                    : "border-gray-200 text-gray-500 hover:border-gray-300"
                }`}
              >
                <Lock size={14} className="shrink-0" />
                <div className="text-left">
                  <div className="font-medium text-xs">Private</div>
                  <div className="text-[10px] opacity-70">Invite only</div>
                </div>
              </button>
            </div>

            <div className="flex gap-3">
              <button
                onClick={() => { setShowCreateModal(false); setNewBoardVisibility("public"); }}
                className="flex-1 px-4 py-2.5 text-sm font-medium text-gray-600 bg-gray-100 rounded-xl hover:bg-gray-200 transition"
              >
                Cancel
              </button>
              <button
                onClick={handleCreateBoard}
                className="flex-1 px-4 py-2.5 text-sm font-medium text-white rounded-xl transition shadow-md"
                style={{ backgroundColor: "#0F2044" }}
                onMouseEnter={e => (e.currentTarget.style.opacity="0.85")}
                onMouseLeave={e => (e.currentTarget.style.opacity="1")}
              >
                Create
              </button>
            </div>
          </div>
        </div>
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

      {/* Delete / Leave Confirmation */}
      {pendingBoardAction && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm" onClick={() => setPendingBoardAction(null)}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm mx-4 p-6" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-lg font-semibold text-gray-900 mb-2">
              {pendingBoardAction.isOwner ? "Delete Board?" : "Leave Board?"}
            </h2>
            <p className="text-sm text-gray-500 mb-4">
              {pendingBoardAction.isOwner
                ? "This board will be removed from your dashboard."
                : "You will be removed from this board, but it will remain for other collaborators."}
            </p>
            <div className="flex gap-3">
              <button onClick={() => setPendingBoardAction(null)} className="flex-1 px-4 py-2.5 text-sm font-medium text-gray-600 bg-gray-100 rounded-xl hover:bg-gray-200 transition">Cancel</button>
              {pendingBoardAction.isOwner ? (
                <button onClick={() => handleDeleteBoard(pendingBoardAction.boardId)} className="flex-1 px-4 py-2.5 text-sm font-medium text-white bg-red-600 rounded-xl hover:bg-red-700 transition shadow-md">Delete</button>
              ) : (
                <button onClick={() => handleLeaveBoard(pendingBoardAction.boardId)} className="flex-1 px-4 py-2.5 text-sm font-medium text-white bg-amber-600 rounded-xl hover:bg-amber-700 transition shadow-md">Leave</button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Board Card ─────────────────────────────────────────────

interface BoardItemProps {
  meta: BoardMetadata;
  isOwner: boolean;
  onOpen: () => void;
  onDelete?: () => void;
  onCopyInvite?: () => void;
  onCopyBoardId?: () => void;
  formatDate: (ts: number) => string;
}

interface BoardActionMenuProps {
  title: string;
  isOwner: boolean;
  onOpen: () => void;
  onDelete?: () => void;
  /** Owner-only: copies the board's invite link to the clipboard. */
  onCopyInvite?: () => void;
  /** Copies the board ID to the clipboard (available to all members). */
  onCopyBoardId?: () => void;
}

/**
 * Board action menu rendered via a portal so it is never clipped by a parent
 * `overflow-hidden` container (e.g. the card thumbnail wrapper).
 *
 * Exported as `BoardActionMenuTest` for unit-test access.
 */
export function BoardActionMenuTest({
  title,
  isOwner,
  onOpen,
  onDelete,
  onCopyInvite,
  onCopyBoardId,
}: BoardActionMenuProps) {
  const [open, setOpen] = useState(false);
  const [menuPos, setMenuPos] = useState({ top: 0, right: 0 });
  const buttonRef = useRef<HTMLButtonElement>(null);

  // Close on any window click
  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    window.addEventListener("click", close);
    return () => window.removeEventListener("click", close);
  }, [open]);

  const handleTrigger = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!open && buttonRef.current) {
      const rect = buttonRef.current.getBoundingClientRect();
      setMenuPos({
        top: rect.bottom + 4,
        right: window.innerWidth - rect.right,
      });
    }
    setOpen((v) => !v);
  };

  const close = () => setOpen(false);

  const dropdown = open
    ? createPortal(
        <div
          data-testid="board-action-dropdown"
          onClick={(e) => e.stopPropagation()}
          style={{ position: "fixed", top: menuPos.top, right: menuPos.right, zIndex: 9999 }}
          className="w-48 bg-white border border-gray-200 rounded-xl shadow-lg p-1"
        >
          {/* Primary action */}
          <button
            onClick={(e) => { e.stopPropagation(); close(); onOpen(); }}
            className="w-full text-left px-2.5 py-2 text-sm text-gray-700 hover:bg-gray-50 rounded-lg flex items-center gap-2"
          >
            <ExternalLink size={13} /> Open
          </button>

          {/* Share actions */}
          {(isOwner ? onCopyInvite : null) && (
            <>
              <div className="my-1 border-t border-gray-100" />
              <button
                onClick={(e) => { e.stopPropagation(); close(); onCopyInvite!(); }}
                className="w-full text-left px-2.5 py-2 text-sm text-gray-700 hover:bg-gray-50 rounded-lg flex items-center gap-2"
              >
                <Link2 size={13} /> Copy invite link
              </button>
            </>
          )}
          {onCopyBoardId && (
            <>
              {!isOwner && <div className="my-1 border-t border-gray-100" />}
              <button
                onClick={(e) => { e.stopPropagation(); close(); onCopyBoardId(); }}
                className="w-full text-left px-2.5 py-2 text-sm text-gray-700 hover:bg-gray-50 rounded-lg flex items-center gap-2"
              >
                <Copy size={13} /> Copy board ID
              </button>
            </>
          )}

          {/* Destructive action */}
          {onDelete && (
            <>
              <div className="my-1 border-t border-gray-100" />
              <button
                aria-label={isOwner ? `Delete board ${title}` : `Leave board ${title}`}
                onClick={(e) => { e.stopPropagation(); close(); onDelete(); }}
                className={`w-full text-left px-2.5 py-2 text-sm rounded-lg flex items-center gap-2 ${
                  isOwner ? "text-red-600 hover:bg-red-50" : "text-amber-700 hover:bg-amber-50"
                }`}
              >
                {isOwner ? <Trash2 size={13} /> : <LogOut size={13} />}
                {isOwner ? "Delete board" : "Leave board"}
              </button>
            </>
          )}
        </div>,
        document.body
      )
    : null;

  return (
    <div>
      <button
        ref={buttonRef}
        aria-label={`Board actions ${title}`}
        onClick={handleTrigger}
        className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition"
      >
        <MoreHorizontal size={14} />
      </button>
      {dropdown}
    </div>
  );
}

// Internal alias kept for backward-compat with the card/row components below
function BoardActionMenu(props: BoardActionMenuProps) {
  return <BoardActionMenuTest {...props} />;
}

function BoardCard({ meta, isOwner, onOpen, onDelete, onCopyInvite, onCopyBoardId, formatDate }: BoardItemProps) {
  const hash = meta.id.split("").reduce((acc, c) => acc + c.charCodeAt(0), 0);
  const hue1 = hash % 360;
  const hue2 = (hash * 7) % 360;
  const thumbnail = localStorage.getItem(`collabboard-thumb-${meta.id}`);

  return (
    <div className="group bg-white rounded-xl border border-gray-200 overflow-hidden shadow-sm hover:shadow-md transition-all hover:border-emerald-300 cursor-pointer" onClick={onOpen}>
      <div className="h-32 relative overflow-hidden" style={thumbnail ? {} : { background: `linear-gradient(135deg, hsl(${hue1}, 70%, 92%), hsl(${hue2}, 60%, 88%))` }}>
        {thumbnail ? (
          <img src={thumbnail} alt={meta.title || "Board preview"} className="w-full h-full object-cover" />
        ) : (
          <div className="absolute inset-0 opacity-30">
            <div className="absolute top-4 left-4 w-16 h-12 bg-white/60 rounded-lg" />
            <div className="absolute top-8 right-6 w-10 h-10 bg-white/50 rounded-md rotate-12" />
            <div className="absolute bottom-4 left-1/3 w-20 h-8 bg-white/40 rounded-lg" />
          </div>
        )}
        <div className="absolute inset-0 bg-black/0 group-hover:bg-black/10 transition flex items-center justify-center opacity-0 group-hover:opacity-100">
          <span className="px-4 py-2 bg-white/90 rounded-lg text-sm font-medium text-gray-700 shadow-sm flex items-center gap-1.5">
            <ExternalLink size={14} /> Open
          </span>
        </div>
      </div>
      <div className="p-4">
        <div className="flex items-start justify-between">
          <div className="flex-1 min-w-0">
            <h3 className="font-semibold text-gray-900 truncate text-sm">{meta.title || "Untitled Board"}</h3>
            <div className="flex items-center gap-3 mt-1.5 text-xs text-gray-400">
              <span className="flex items-center gap-1"><Clock size={11} />{formatDate(meta.updatedAt)}</span>
              {!isOwner && <span className="flex items-center gap-1"><Users size={11} />Shared</span>}
              {meta.visibility === "private"
                ? <span className="flex items-center gap-1 text-indigo-400"><Lock size={11} />Private</span>
                : <span className="flex items-center gap-1 text-emerald-500"><Globe size={11} />Public</span>}
            </div>
          </div>
          <BoardActionMenu
            title={meta.title || "Untitled Board"}
            isOwner={isOwner}
            onOpen={onOpen}
            onDelete={onDelete}
            onCopyInvite={onCopyInvite}
            onCopyBoardId={onCopyBoardId}
          />
        </div>
      </div>
    </div>
  );
}

function BoardRow({ meta, isOwner, onOpen, onDelete, onCopyInvite, onCopyBoardId, formatDate }: BoardItemProps) {
  const hash = meta.id.split("").reduce((acc, c) => acc + c.charCodeAt(0), 0);

  return (
    <div className="group flex items-center gap-4 px-4 py-3 bg-white rounded-xl border border-gray-200 hover:border-emerald-300 hover:shadow-sm transition cursor-pointer" onClick={onOpen}>
      <div className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: `hsl(${hash % 360}, 60%, 65%)` }} />
      <div className="flex-1 min-w-0"><h3 className="font-medium text-gray-900 truncate text-sm">{meta.title || "Untitled Board"}</h3></div>
      {!isOwner && <span className="text-xs text-gray-400 flex items-center gap-1 shrink-0"><Users size={11} />Shared</span>}
      {meta.visibility === "private"
        ? <span className="text-xs text-indigo-400 flex items-center gap-1 shrink-0"><Lock size={11} />Private</span>
        : <span className="text-xs text-emerald-500 flex items-center gap-1 shrink-0"><Globe size={11} />Public</span>}
      <span className="text-xs text-gray-400 flex items-center gap-1 shrink-0"><Clock size={11} />{formatDate(meta.updatedAt)}</span>
      <BoardActionMenu
        title={meta.title || "Untitled Board"}
        isOwner={isOwner}
        onOpen={onOpen}
        onDelete={onDelete}
        onCopyInvite={onCopyInvite}
        onCopyBoardId={onCopyBoardId}
      />
    </div>
  );
}
