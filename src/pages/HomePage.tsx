import { useState, useEffect, useMemo, useCallback } from "react";
import { useAuth } from "../components/auth/AuthProvider";
import {
  getUserBoards,
  createBoard,
  joinBoard,
  softDeleteBoard,
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
} from "lucide-react";

interface HomePageProps {
  onNavigateToBoard: (boardId: string) => void;
}

type ViewMode = "grid" | "list";

export function HomePage({ onNavigateToBoard }: HomePageProps) {
  const { user, displayName, signOut } = useAuth();
  const userId = user?.id || "";
  const [boards, setBoards] = useState<BoardMetadata[]>([]);
  const [loading, setLoading] = useState(true);
  const [joinBoardId, setJoinBoardId] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [viewMode, setViewMode] = useState<ViewMode>("grid");
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newBoardTitle, setNewBoardTitle] = useState("");
  const [deletingBoardId, setDeletingBoardId] = useState<string | null>(null);

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
      const boardId = await createBoard(title, userId);
      setShowCreateModal(false);
      setNewBoardTitle("");
      onNavigateToBoard(boardId);
    } catch (err) {
      console.error("Failed to create board:", err);
    }
  }, [newBoardTitle, userId, onNavigateToBoard]);

  const handleJoinBoard = useCallback(async () => {
    const id = joinBoardId.trim();
    if (id && userId) {
      try {
        await joinBoard(id, userId);
        onNavigateToBoard(id);
      } catch (err) {
        console.error("Failed to join board:", err);
      }
    }
  }, [joinBoardId, userId, onNavigateToBoard]);

  const handleDeleteBoard = useCallback(async (boardId: string) => {
    try {
      await softDeleteBoard(boardId);
      setBoards((prev) => prev.filter((b) => b.id !== boardId));
    } catch (err) {
      console.error("Failed to delete board:", err);
    }
    setDeletingBoardId(null);
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
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-indigo-50">
      {/* Header */}
      <header className="bg-white/80 backdrop-blur-sm border-b border-gray-200 sticky top-0 z-20">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 flex items-center justify-between">
          <h1 className="text-2xl font-bold text-gray-900">🎨 CollabBoard</h1>
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
                className="w-full pl-9 pr-4 py-2.5 bg-white border border-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none transition shadow-sm"
              />
            </div>
            <div className="flex items-center bg-white border border-gray-200 rounded-lg overflow-hidden shadow-sm">
              <button
                onClick={() => setViewMode("grid")}
                className={`p-2 transition ${viewMode === "grid" ? "bg-indigo-50 text-indigo-600" : "text-gray-400 hover:text-gray-600"}`}
              >
                <LayoutGrid size={16} />
              </button>
              <button
                onClick={() => setViewMode("list")}
                className={`p-2 transition ${viewMode === "list" ? "bg-indigo-50 text-indigo-600" : "text-gray-400 hover:text-gray-600"}`}
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
                className="w-32 px-3 py-2.5 bg-white border border-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none transition shadow-sm"
              />
              <button onClick={handleJoinBoard} disabled={!joinBoardId.trim()} className="px-4 py-2.5 bg-gray-800 text-white rounded-xl text-sm font-medium hover:bg-gray-900 transition disabled:opacity-50 shadow-sm">
                Join
              </button>
            </div>
            <button onClick={() => setShowCreateModal(true)} className="flex items-center gap-2 px-5 py-2.5 bg-indigo-600 text-white rounded-xl text-sm font-medium hover:bg-indigo-700 transition shadow-md hover:shadow-lg">
              <Plus size={16} />
              New Board
            </button>
          </div>
        </div>

        {loading && (
          <div className="flex items-center justify-center py-20">
            <div className="animate-spin w-8 h-8 border-4 border-indigo-200 border-t-indigo-600 rounded-full" />
          </div>
        )}

        {!loading && filteredBoards.length === 0 && !searchQuery && (
          <div className="text-center py-20">
            <div className="text-6xl mb-4">🎨</div>
            <h2 className="text-xl font-semibold text-gray-700 mb-2">No boards yet</h2>
            <p className="text-gray-500 mb-6">Create your first collaborative whiteboard to get started.</p>
            <button onClick={() => setShowCreateModal(true)} className="inline-flex items-center gap-2 px-6 py-3 bg-indigo-600 text-white rounded-xl font-medium hover:bg-indigo-700 transition shadow-md">
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
                  <BoardCard key={meta.id} meta={meta} isOwner onOpen={() => onNavigateToBoard(meta.id)} onDelete={() => setDeletingBoardId(meta.id)} formatDate={formatDate} />
                ) : (
                  <BoardRow key={meta.id} meta={meta} isOwner onOpen={() => onNavigateToBoard(meta.id)} onDelete={() => setDeletingBoardId(meta.id)} formatDate={formatDate} />
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
                  <BoardCard key={meta.id} meta={meta} isOwner={false} onOpen={() => onNavigateToBoard(meta.id)} formatDate={formatDate} />
                ) : (
                  <BoardRow key={meta.id} meta={meta} isOwner={false} onOpen={() => onNavigateToBoard(meta.id)} formatDate={formatDate} />
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
            <input autoFocus type="text" value={newBoardTitle} onChange={(e) => setNewBoardTitle(e.target.value)} onKeyDown={(e) => e.key === "Enter" && handleCreateBoard()} placeholder="Board title (optional)" className="w-full px-4 py-3 border border-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none transition mb-4" />
            <div className="flex gap-3">
              <button onClick={() => setShowCreateModal(false)} className="flex-1 px-4 py-2.5 text-sm font-medium text-gray-600 bg-gray-100 rounded-xl hover:bg-gray-200 transition">Cancel</button>
              <button onClick={handleCreateBoard} className="flex-1 px-4 py-2.5 text-sm font-medium text-white bg-indigo-600 rounded-xl hover:bg-indigo-700 transition shadow-md">Create</button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Confirmation */}
      {deletingBoardId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm" onClick={() => setDeletingBoardId(null)}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm mx-4 p-6" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-lg font-semibold text-gray-900 mb-2">Delete Board?</h2>
            <p className="text-sm text-gray-500 mb-4">This board will be removed from your dashboard.</p>
            <div className="flex gap-3">
              <button onClick={() => setDeletingBoardId(null)} className="flex-1 px-4 py-2.5 text-sm font-medium text-gray-600 bg-gray-100 rounded-xl hover:bg-gray-200 transition">Cancel</button>
              <button onClick={() => handleDeleteBoard(deletingBoardId)} className="flex-1 px-4 py-2.5 text-sm font-medium text-white bg-red-600 rounded-xl hover:bg-red-700 transition shadow-md">Delete</button>
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
  formatDate: (ts: number) => string;
}

function BoardCard({ meta, isOwner, onOpen, onDelete, formatDate }: BoardItemProps) {
  const hash = meta.id.split("").reduce((acc, c) => acc + c.charCodeAt(0), 0);
  const hue1 = hash % 360;
  const hue2 = (hash * 7) % 360;

  return (
    <div className="group bg-white rounded-xl border border-gray-200 overflow-hidden shadow-sm hover:shadow-md transition-all hover:border-indigo-300 cursor-pointer" onClick={onOpen}>
      <div className="h-32 relative overflow-hidden" style={{ background: `linear-gradient(135deg, hsl(${hue1}, 70%, 92%), hsl(${hue2}, 60%, 88%))` }}>
        <div className="absolute inset-0 opacity-30">
          <div className="absolute top-4 left-4 w-16 h-12 bg-white/60 rounded-lg" />
          <div className="absolute top-8 right-6 w-10 h-10 bg-white/50 rounded-md rotate-12" />
          <div className="absolute bottom-4 left-1/3 w-20 h-8 bg-white/40 rounded-lg" />
        </div>
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
            </div>
          </div>
          {isOwner && onDelete && (
            <button onClick={(e) => { e.stopPropagation(); onDelete(); }} className="p-1.5 rounded-lg text-gray-300 hover:text-red-500 hover:bg-red-50 transition opacity-0 group-hover:opacity-100">
              <Trash2 size={14} />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function BoardRow({ meta, isOwner, onOpen, onDelete, formatDate }: BoardItemProps) {
  const hash = meta.id.split("").reduce((acc, c) => acc + c.charCodeAt(0), 0);

  return (
    <div className="group flex items-center gap-4 px-4 py-3 bg-white rounded-xl border border-gray-200 hover:border-indigo-300 hover:shadow-sm transition cursor-pointer" onClick={onOpen}>
      <div className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: `hsl(${hash % 360}, 60%, 65%)` }} />
      <div className="flex-1 min-w-0"><h3 className="font-medium text-gray-900 truncate text-sm">{meta.title || "Untitled Board"}</h3></div>
      {!isOwner && <span className="text-xs text-gray-400 flex items-center gap-1 shrink-0"><Users size={11} />Shared</span>}
      <span className="text-xs text-gray-400 flex items-center gap-1 shrink-0"><Clock size={11} />{formatDate(meta.updatedAt)}</span>
      {isOwner && onDelete && (
        <button onClick={(e) => { e.stopPropagation(); onDelete(); }} className="p-1.5 rounded-lg text-gray-300 hover:text-red-500 hover:bg-red-50 transition opacity-0 group-hover:opacity-100">
          <Trash2 size={14} />
        </button>
      )}
    </div>
  );
}
