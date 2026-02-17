import { Link } from "lucide-react";
import type { UserPresence } from "../../types/presence";

interface PresencePanelProps {
  users: Record<string, UserPresence>;
  currentUserId: string;
  onShareClick: () => void;
  linkCopied: boolean;
}

export function PresencePanel({ users, currentUserId, onShareClick, linkCopied }: PresencePanelProps) {
  const onlineUsers = Object.entries(users).filter(
    ([, presence]) => presence.online
  );

  return (
    <div className="fixed top-4 right-4 z-50 bg-white rounded-xl shadow-lg border border-gray-200 p-3 min-w-[180px]">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full bg-green-500" />
          <span className="text-xs font-medium text-gray-500 uppercase tracking-wider">
            Online ({onlineUsers.length})
          </span>
        </div>
        <button
          onClick={onShareClick}
          className="p-1.5 rounded-lg hover:bg-gray-100 transition text-gray-500 hover:text-gray-700"
          title={linkCopied ? "Link copied!" : "Copy board link"}
        >
          {linkCopied ? (
            <span className="text-xs text-green-600 font-medium">✓</span>
          ) : (
            <Link size={14} />
          )}
        </button>
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
