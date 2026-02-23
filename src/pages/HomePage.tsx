import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { createPortal } from "react-dom";
import { useAuth } from "../components/auth/AuthProvider";
import {
  getUserBoards,
  createBoard,
  softDeleteBoard,
} from "../services/board-crud";
import {
  joinBoard,
  removeBoardMember,
  getInviteToken,
} from "../services/board-access";
import type { BoardMetadata } from "../services/board-types";
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

// Inline logo matching the login page — Newspaper theme
function CollabBoardLogo({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none" aria-hidden>
      <rect x="2" y="2" width="12" height="28" fill="#111111" />
      <rect x="18" y="2" width="12" height="28" fill="#111111" />
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

    if (diffMins < 1) return "JUST NOW";
    if (diffMins < 60) return `${diffMins}M AGO`;
    if (diffHours < 24) return `${diffHours}H AGO`;
    if (diffDays < 7) return `${diffDays}D AGO`;
    return date.toLocaleDateString().toUpperCase();
  };

  return (
    <div className="min-h-screen bg-newsprint-bg newsprint-texture">
      {/* Header */}
      <header className="bg-newsprint-bg border-b-2 border-newsprint-fg sticky top-0 z-20">
        <div className="max-w-screen-xl mx-auto px-4 sm:px-6 lg:px-8 py-4 flex items-center justify-between">
          <h1 className="text-3xl font-black font-serif flex items-center gap-3 text-newsprint-fg uppercase tracking-tighter">
            <CollabBoardLogo size={32} />
            CollabBoard
          </h1>
          <div className="flex items-center gap-6">
            <span className="text-xs uppercase tracking-widest font-mono text-neutral-600">
              User: <span className="font-bold text-newsprint-fg">{displayName}</span>
            </span>
            <button
              onClick={signOut}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs uppercase tracking-widest font-bold text-newsprint-fg border border-transparent hover:border-newsprint-fg hover:bg-neutral-100 transition-colors duration-200 sharp-corners"
            >
              <LogOut size={14} strokeWidth={1.5} />
              Sign out
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-screen-xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        {/* Action bar */}
        <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-6 mb-12 border-b-4 border-newsprint-fg pb-8">
          <div className="flex items-center gap-4 flex-1 w-full md:w-auto">
            <div className="relative flex-1 max-w-md">
              <Search size={16} strokeWidth={1.5} className="absolute left-3 top-1/2 -translate-y-1/2 text-newsprint-fg" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="SEARCH BOARDS..."
                className="w-full pl-9 pr-4 py-2 bg-transparent border-b-2 border-newsprint-fg sharp-corners text-sm font-mono text-newsprint-fg focus-visible:bg-neutral-100 focus-visible:outline-none transition-colors placeholder:text-neutral-500"
              />
            </div>
            <div className="flex items-center bg-transparent border border-newsprint-fg sharp-corners overflow-hidden">
              <button
                onClick={() => setViewMode("grid")}
                className={`p-2 transition-colors duration-200 sharp-corners ${viewMode === "grid" ? "bg-newsprint-fg text-newsprint-bg" : "text-newsprint-fg hover:bg-neutral-200"}`}
              >
                <LayoutGrid size={16} strokeWidth={1.5} />
              </button>
              <button
                onClick={() => setViewMode("list")}
                className={`p-2 transition-colors duration-200 sharp-corners ${viewMode === "list" ? "bg-newsprint-fg text-newsprint-bg" : "text-newsprint-fg hover:bg-neutral-200"}`}
              >
                <List size={16} strokeWidth={1.5} />
              </button>
            </div>
          </div>

          <div className="flex items-center gap-4 w-full md:w-auto">
            <div className="flex gap-2 w-full md:w-auto">
              <input
                id="join-board-id"
                name="boardId"
                type="text"
                value={joinBoardId}
                onChange={(e) => setJoinBoardId(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleJoinBoard()}
                placeholder="BOARD ID"
                className="w-32 md:w-40 px-3 py-2 bg-transparent border-b-2 border-newsprint-fg sharp-corners text-sm font-mono text-newsprint-fg focus-visible:bg-neutral-100 focus-visible:outline-none transition-colors placeholder:text-neutral-500"
              />
              <button 
                onClick={handleJoinBoard} 
                disabled={!joinBoardId.trim()} 
                className="px-4 py-2 border border-newsprint-fg bg-transparent hover:bg-newsprint-fg hover:text-newsprint-bg text-newsprint-fg uppercase tracking-widest text-xs font-bold sharp-corners transition-all duration-200 disabled:opacity-50"
              >
                Join
              </button>
            </div>
            <button 
              onClick={() => setShowCreateModal(true)} 
              className="flex items-center gap-2 px-6 py-2.5 bg-newsprint-fg text-newsprint-bg border border-transparent hover:bg-white hover:text-newsprint-fg hover:border-newsprint-fg uppercase tracking-widest text-xs font-bold sharp-corners transition-all duration-200 w-full md:w-auto justify-center"
            >
              <Plus size={16} strokeWidth={1.5} />
              New Board
            </button>
          </div>
        </div>

        {loading && (
          <div className="flex items-center justify-center py-20">
            <div className="animate-spin w-8 h-8 border-4 border-newsprint-muted border-t-newsprint-fg rounded-full" />
          </div>
        )}

        {!loading && filteredBoards.length === 0 && !searchQuery && (
          <div className="text-center py-24 border border-newsprint-fg bg-white p-12 max-w-2xl mx-auto sharp-corners hard-shadow-hover">
            <div className="w-16 h-16 border-2 border-newsprint-fg flex items-center justify-center mx-auto mb-6 sharp-corners bg-neutral-100">
              <CollabBoardLogo size={34} />
            </div>
            <h2 className="text-3xl font-black font-serif mb-4 text-newsprint-fg">NO BOARDS YET</h2>
            <p className="text-newsprint-fg font-body text-lg mb-8">Create your first collaborative whiteboard to share ideas with your team.</p>
            <button 
              onClick={() => setShowCreateModal(true)} 
              className="inline-flex items-center gap-2 px-8 py-4 bg-newsprint-fg text-newsprint-bg border border-transparent hover:bg-white hover:text-newsprint-fg hover:border-newsprint-fg uppercase tracking-widest text-sm font-bold sharp-corners transition-all duration-200"
            >
              <Plus size={18} strokeWidth={1.5} />
              Create Your First Board
            </button>
          </div>
        )}

        {!loading && filteredBoards.length === 0 && searchQuery && (
          <div className="text-center py-20 border border-newsprint-fg sharp-corners bg-white">
            <p className="text-newsprint-fg font-mono uppercase tracking-widest">No matching boards found for "{searchQuery}"</p>
          </div>
        )}

        {myBoards.length > 0 && (
          <section className="mb-16">
            <h2 className="text-2xl font-black font-serif border-b-2 border-newsprint-fg pb-2 mb-6 uppercase tracking-tighter">My Boards <span className="font-mono text-sm align-top ml-2">({myBoards.length})</span></h2>
            <div className={viewMode === "grid" ? "grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6" : "space-y-4"}>
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
          <section className="mb-16">
            <h2 className="text-2xl font-black font-serif border-b-2 border-newsprint-fg pb-2 mb-6 uppercase tracking-tighter">Shared With Me <span className="font-mono text-sm align-top ml-2">({sharedBoards.length})</span></h2>
            <div className={viewMode === "grid" ? "grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6" : "space-y-4"}>
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
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={() => setShowCreateModal(false)}>
          <div className="bg-newsprint-bg border-2 border-newsprint-fg sharp-corners shadow-[8px_8px_0px_0px_#111111] w-full max-w-md mx-4 p-8" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-2xl font-black font-serif text-newsprint-fg mb-6 uppercase">New Board</h2>
            <input
              autoFocus
              type="text"
              value={newBoardTitle}
              onChange={(e) => setNewBoardTitle(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleCreateBoard()}
              placeholder="HEADLINE (OPTIONAL)"
              className="w-full px-4 py-3 border-b-2 border-newsprint-fg bg-transparent text-sm font-mono focus-visible:bg-neutral-100 focus-visible:outline-none outline-none transition mb-8"
            />

            {/* Visibility picker */}
            <div className="flex gap-4 mb-8">
              <button
                onClick={() => setNewBoardVisibility("public")}
                className={`flex-1 flex flex-col items-center justify-center gap-2 px-3 py-4 border-2 sharp-corners transition-colors duration-200 ${
                  newBoardVisibility === "public"
                    ? "border-newsprint-fg bg-newsprint-fg text-newsprint-bg"
                    : "border-newsprint-muted text-newsprint-fg hover:border-newsprint-fg"
                }`}
              >
                <Globe size={20} strokeWidth={1.5} />
                <div className="text-center">
                  <div className="font-bold text-xs uppercase tracking-widest">Public</div>
                  <div className={`text-[10px] uppercase mt-1 ${newBoardVisibility === 'public' ? 'text-newsprint-bg opacity-80' : 'text-neutral-500'}`}>Anyone with link</div>
                </div>
              </button>
              <button
                onClick={() => setNewBoardVisibility("private")}
                className={`flex-1 flex flex-col items-center justify-center gap-2 px-3 py-4 border-2 sharp-corners transition-colors duration-200 ${
                  newBoardVisibility === "private"
                    ? "border-newsprint-fg bg-newsprint-fg text-newsprint-bg"
                    : "border-newsprint-muted text-newsprint-fg hover:border-newsprint-fg"
                }`}
              >
                <Lock size={20} strokeWidth={1.5} />
                <div className="text-center">
                  <div className="font-bold text-xs uppercase tracking-widest">Private</div>
                  <div className={`text-[10px] uppercase mt-1 ${newBoardVisibility === 'private' ? 'text-newsprint-bg opacity-80' : 'text-neutral-500'}`}>Invite only</div>
                </div>
              </button>
            </div>

            <div className="flex gap-4">
              <button
                onClick={() => { setShowCreateModal(false); setNewBoardVisibility("public"); }}
                className="flex-1 px-4 py-3 text-xs uppercase tracking-widest font-bold text-newsprint-fg border border-newsprint-fg bg-transparent hover:bg-neutral-200 sharp-corners transition"
              >
                Cancel
              </button>
              <button
                onClick={handleCreateBoard}
                className="flex-1 px-4 py-3 text-xs uppercase tracking-widest font-bold text-newsprint-bg bg-newsprint-fg border border-transparent hover:bg-white hover:text-newsprint-fg hover:border-newsprint-fg sharp-corners transition"
              >
                Publish
              </button>
            </div>
          </div>
        </div>
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

      {/* Delete / Leave Confirmation */}
      {pendingBoardAction && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={() => setPendingBoardAction(null)}>
          <div className="bg-newsprint-bg border-2 border-newsprint-fg sharp-corners shadow-[8px_8px_0px_0px_#111111] w-full max-w-sm mx-4 p-8" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-2xl font-black font-serif text-newsprint-fg mb-4 uppercase">
              {pendingBoardAction.isOwner ? "Delete Board?" : "Leave Board?"}
            </h2>
            <p className="text-sm font-body text-newsprint-fg mb-8 leading-relaxed">
              {pendingBoardAction.isOwner
                ? "This board will be permanently removed."
                : "You will be removed from this board, but it will remain available for others."}
            </p>
            <div className="flex gap-4">
              <button onClick={() => setPendingBoardAction(null)} className="flex-1 px-4 py-3 text-xs uppercase tracking-widest font-bold text-newsprint-fg border border-newsprint-fg bg-transparent hover:bg-neutral-200 sharp-corners transition">Cancel</button>
              {pendingBoardAction.isOwner ? (
                <button onClick={() => handleDeleteBoard(pendingBoardAction.boardId)} className="flex-1 px-4 py-3 text-xs uppercase tracking-widest font-bold text-white bg-newsprint-accent border border-newsprint-fg hover:bg-red-800 sharp-corners transition">Delete</button>
              ) : (
                <button onClick={() => handleLeaveBoard(pendingBoardAction.boardId)} className="flex-1 px-4 py-3 text-xs uppercase tracking-widest font-bold text-newsprint-bg bg-newsprint-fg border border-transparent hover:bg-white hover:text-newsprint-fg hover:border-newsprint-fg sharp-corners transition">Leave</button>
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
  onCopyInvite?: () => void;
  onCopyBoardId?: () => void;
}

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
          className="w-56 bg-newsprint-bg border-2 border-newsprint-fg sharp-corners shadow-[4px_4px_0px_0px_#111111] p-0"
        >
          <button
            onClick={(e) => { e.stopPropagation(); close(); onOpen(); }}
            className="w-full text-left px-4 py-3 text-xs uppercase tracking-widest font-bold text-newsprint-fg hover:bg-newsprint-fg hover:text-newsprint-bg flex items-center gap-3 transition-colors border-b border-newsprint-muted"
          >
            <ExternalLink size={14} strokeWidth={1.5} /> Open
          </button>

          {(isOwner ? onCopyInvite : null) && (
            <button
              onClick={(e) => { e.stopPropagation(); close(); onCopyInvite!(); }}
              className="w-full text-left px-4 py-3 text-xs uppercase tracking-widest font-bold text-newsprint-fg hover:bg-newsprint-fg hover:text-newsprint-bg flex items-center gap-3 transition-colors border-b border-newsprint-muted"
            >
              <Link2 size={14} strokeWidth={1.5} /> Copy Invite Link
            </button>
          )}
          {onCopyBoardId && (
            <button
              onClick={(e) => { e.stopPropagation(); close(); onCopyBoardId(); }}
              className="w-full text-left px-4 py-3 text-xs uppercase tracking-widest font-bold text-newsprint-fg hover:bg-newsprint-fg hover:text-newsprint-bg flex items-center gap-3 transition-colors border-b border-newsprint-muted"
            >
              <Copy size={14} strokeWidth={1.5} /> Copy ID
            </button>
          )}

          {onDelete && (
            <button
              aria-label={isOwner ? `Delete board ${title}` : `Leave board ${title}`}
              onClick={(e) => { e.stopPropagation(); close(); onDelete(); }}
              className={`w-full text-left px-4 py-3 text-xs uppercase tracking-widest font-bold flex items-center gap-3 transition-colors ${
                isOwner ? "text-newsprint-accent hover:bg-newsprint-accent hover:text-white" : "text-newsprint-fg hover:bg-neutral-200"
              }`}
            >
              {isOwner ? <Trash2 size={14} strokeWidth={1.5} /> : <LogOut size={14} strokeWidth={1.5} />}
              {isOwner ? "Delete" : "Leave"}
            </button>
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
        className="p-2 sharp-corners border border-transparent hover:border-newsprint-fg hover:bg-neutral-100 text-newsprint-fg transition-colors"
      >
        <MoreHorizontal size={16} strokeWidth={1.5} />
      </button>
      {dropdown}
    </div>
  );
}

function BoardActionMenu(props: BoardActionMenuProps) {
  return <BoardActionMenuTest {...props} />;
}

function BoardCard({ meta, isOwner, onOpen, onDelete, onCopyInvite, onCopyBoardId, formatDate }: BoardItemProps) {
  const thumbnail = localStorage.getItem(`collabboard-thumb-${meta.id}`);

  return (
    <div className="group bg-white border border-newsprint-fg sharp-corners hover:hard-shadow-hover transition-all duration-200 cursor-pointer flex flex-col" onClick={onOpen}>
      <div className="h-40 relative overflow-hidden border-b border-newsprint-fg bg-neutral-100">
        {thumbnail ? (
          <img src={thumbnail} alt={meta.title || "Board preview"} className="w-full h-full object-cover grayscale group-hover:sepia-[.30] transition-all duration-300" />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center opacity-30">
            <div className="absolute inset-0 bg-[radial-gradient(#000_1px,transparent_1px)] opacity-20 [background-size:16px_16px]" />
            <div className="w-16 h-16 border-2 border-newsprint-fg bg-white rotate-6" />
            <div className="w-20 h-12 border-2 border-newsprint-fg bg-white -rotate-3 absolute bottom-6 right-6" />
          </div>
        )}
        <div className="absolute inset-0 bg-newsprint-fg/0 group-hover:bg-newsprint-fg/5 transition-colors flex items-center justify-center opacity-0 group-hover:opacity-100">
          <span className="px-4 py-2 bg-newsprint-fg text-newsprint-bg sharp-corners text-xs font-mono uppercase tracking-widest font-bold shadow-[2px_2px_0px_0px_#111111] flex items-center gap-2">
            <ExternalLink size={14} strokeWidth={1.5} /> Read
          </span>
        </div>
        {/* Board ID badge */}
        <div className="absolute top-0 left-0 bg-newsprint-fg text-newsprint-bg px-2 py-1 text-[10px] font-mono uppercase font-bold tracking-widest border-r border-b border-newsprint-fg">
          {meta.id.slice(0, 8).toUpperCase()}
        </div>
      </div>
      <div className="p-5 flex-1 flex flex-col justify-between">
        <div>
          <h3 className="font-bold font-serif text-xl text-newsprint-fg leading-tight mb-3 line-clamp-2 uppercase">{meta.title || "Untitled Board"}</h3>
        </div>
        <div className="flex items-end justify-between mt-4 pt-4 border-t border-newsprint-muted">
          <div className="flex flex-col gap-1.5 text-[10px] font-mono uppercase tracking-widest text-neutral-600">
            <span className="flex items-center gap-1.5"><Clock size={12} strokeWidth={1.5} /> {formatDate(meta.updatedAt)}</span>
            <div className="flex items-center gap-3 mt-1">
              {!isOwner && <span className="flex items-center gap-1.5 text-newsprint-fg font-bold"><Users size={12} strokeWidth={1.5} /> Shared</span>}
              {meta.visibility === "private"
                ? <span className="flex items-center gap-1.5 text-newsprint-fg"><Lock size={12} strokeWidth={1.5} /> Private</span>
                : <span className="flex items-center gap-1.5 text-newsprint-fg"><Globe size={12} strokeWidth={1.5} /> Public</span>}
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
  return (
    <div className="group flex items-center gap-4 px-6 py-4 bg-white border border-newsprint-fg sharp-corners hover:hard-shadow-hover transition-all duration-200 cursor-pointer" onClick={onOpen}>
      <div className="w-12 h-12 shrink-0 border border-newsprint-fg flex items-center justify-center font-serif text-xl font-bold bg-neutral-100">
        {meta.title ? meta.title.charAt(0).toUpperCase() : "U"}
      </div>
      <div className="flex-1 min-w-0">
        <h3 className="font-bold font-serif text-lg text-newsprint-fg truncate uppercase">{meta.title || "Untitled Board"}</h3>
      </div>
      <div className="flex items-center gap-6 hidden sm:flex">
        {!isOwner && <span className="text-[10px] font-mono uppercase tracking-widest text-newsprint-fg font-bold flex items-center gap-1.5 shrink-0"><Users size={12} strokeWidth={1.5} /> Shared</span>}
        {meta.visibility === "private"
          ? <span className="text-[10px] font-mono uppercase tracking-widest text-newsprint-fg flex items-center gap-1.5 shrink-0"><Lock size={12} strokeWidth={1.5} /> Private</span>
          : <span className="text-[10px] font-mono uppercase tracking-widest text-newsprint-fg flex items-center gap-1.5 shrink-0"><Globe size={12} strokeWidth={1.5} /> Public</span>}
        <span className="text-[10px] font-mono uppercase tracking-widest text-neutral-600 flex items-center gap-1.5 shrink-0 w-32"><Clock size={12} strokeWidth={1.5} /> {formatDate(meta.updatedAt)}</span>
      </div>
      <div className="shrink-0 pl-4 border-l border-newsprint-muted hidden sm:block">
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
  );
}
