import type { RemoteUser } from "../../hooks/usePresence";

interface PresencePanelProps {
  users: Record<string, RemoteUser>;
  currentUserId: string;
}

export function PresencePanel({ users, currentUserId }: PresencePanelProps) {
  const onlineUsers = Object.entries(users).filter(
    ([, presence]) => presence.online
  );

  return (
    <div className="bg-white/80 backdrop-blur-sm rounded-lg border border-gray-200 shadow-sm px-2.5 py-2 min-w-[150px]">
      <div className="flex items-center gap-1.5 mb-1.5">
        <div className="w-2 h-2 rounded-full bg-green-500" />
        <span className="text-[10px] font-medium text-gray-400 uppercase tracking-wider">
          Online ({onlineUsers.length})
        </span>
      </div>

      <div className="space-y-1">
        {onlineUsers.map(([uid, presence]) => (
          <div key={uid} className="flex items-center gap-1.5">
            <div
              className="w-2.5 h-2.5 rounded-full flex-shrink-0"
              style={{ backgroundColor: presence.cursorColor }}
            />
            <span className="text-xs text-gray-600 truncate">
              {presence.displayName}
              {uid === currentUserId && (
                <span className="text-gray-400 ml-1">(you)</span>
              )}
            </span>
            {presence.editingObjectId && (
              <span className="text-[10px] text-gray-400 ml-auto">✏️</span>
            )}
          </div>
        ))}
        {onlineUsers.length === 0 && (
          <p className="text-[10px] text-gray-400">No one online</p>
        )}
      </div>
    </div>
  );
}
