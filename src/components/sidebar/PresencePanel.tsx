import { useState, useRef, useEffect } from "react";
import { Link, Copy, Hash } from "lucide-react";
import type { UserPresence } from "../../types/presence";

interface PresencePanelProps {
  users: Record<string, UserPresence>;
  currentUserId: string;
  boardUrl: string;
  boardId: string;
}

type CopiedWhat = "link" | "id" | null;

export function PresencePanel({ users, currentUserId, boardUrl, boardId }: PresencePanelProps) {
  const [shareOpen, setShareOpen] = useState(false);
  const [copiedWhat, setCopiedWhat] = useState<CopiedWhat>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const onlineUsers = Object.entries(users).filter(
    ([, presence]) => presence.online
  );

  // Close dropdown when clicking outside
  useEffect(() => {
    if (!shareOpen) return;
    const handler = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setShareOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [shareOpen]);

  const copy = (text: string, which: CopiedWhat) => {
    navigator.clipboard.writeText(text).then(() => {
      setCopiedWhat(which);
      setTimeout(() => setCopiedWhat(null), 2000);
    });
    setShareOpen(false);
  };

  return (
    <div className="relative bg-white/60 rounded-lg border border-gray-200/50 px-2.5 py-1.5">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full bg-green-500" />
          <span className="text-xs font-medium text-gray-500 uppercase tracking-wider">
            Online ({onlineUsers.length})
          </span>
        </div>

        {/* Share button + dropdown */}
        <div className="relative" ref={dropdownRef}>
          <button
            onClick={() => setShareOpen((o) => !o)}
            className="p-1.5 rounded-lg hover:bg-gray-100 transition text-gray-500 hover:text-gray-700"
            title="Share"
          >
            {copiedWhat ? (
              <span className="text-xs text-green-600 font-medium">✓</span>
            ) : (
              <Link size={14} />
            )}
          </button>

          {shareOpen && (
            <div className="absolute right-0 top-8 w-44 bg-white rounded-xl shadow-xl border border-gray-200 overflow-hidden z-50">
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
      </div>

      <div className="space-y-1.5">
        {onlineUsers.map(([uid, presence]) => (
          <div key={uid} className="flex items-center gap-2">
            <div
              className="w-3 h-3 rounded-full flex-shrink-0"
              style={{ backgroundColor: presence.cursorColor }}
            />
            <span className="text-sm text-gray-700 truncate">
              {presence.displayName}
              {uid === currentUserId && (
                <span className="text-gray-400 ml-1">(you)</span>
              )}
            </span>
            {presence.editingObjectId && (
              <span className="text-xs text-gray-400 ml-auto">✏️</span>
            )}
          </div>
        ))}
        {onlineUsers.length === 0 && (
          <p className="text-xs text-gray-400">No one online</p>
        )}
      </div>
    </div>
  );
}
