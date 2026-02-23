import React from "react";
import type { RemoteUser } from "../../hooks/presence/usePresence";

interface PresencePanelProps {
  users: Record<string, RemoteUser>;
  currentUserId: string;
}

export const PresencePanel = React.memo(function PresencePanel({ users, currentUserId }: PresencePanelProps) {
  const onlineUsers = Object.entries(users).filter(
    ([, presence]) => presence.online
  );

  return (
    <div className="bg-newsprint-bg sharp-corners border-2 border-newsprint-fg shadow-[4px_4px_0px_0px_#111111] px-3 py-2 min-w-[150px]">
      <div className="flex items-center gap-2 mb-2 border-b border-newsprint-fg pb-1">
        <div className="w-2 h-2 sharp-corners bg-newsprint-fg" />
        <span className="text-[10px] font-mono font-bold text-newsprint-fg uppercase tracking-widest">
          Online ({onlineUsers.length})
        </span>
      </div>

      <div className="space-y-1.5">
        {onlineUsers.map(([uid, presence]) => (
          <div key={uid} className="flex items-center gap-2">
            <div
              className="w-2.5 h-2.5 sharp-corners border border-newsprint-fg flex-shrink-0"
              style={{ backgroundColor: presence.cursorColor }}
            />
            <span className="text-xs font-mono font-bold uppercase tracking-widest text-newsprint-fg truncate">
              {presence.displayName}
              {uid === currentUserId && (
                <span className="text-newsprint-muted ml-1">(you)</span>
              )}
            </span>
            {presence.editingObjectId && (
              <span className="text-[10px] text-newsprint-fg ml-auto font-mono font-bold border border-newsprint-fg px-1 sharp-corners bg-neutral-100">EDIT</span>
            )}
          </div>
        ))}
        {onlineUsers.length === 0 && (
          <p className="text-[10px] font-mono uppercase tracking-widest text-newsprint-muted">No one online</p>
        )}
      </div>
    </div>
  );
});
