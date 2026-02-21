import { useState, useEffect, useCallback } from "react";
import { X, Copy, RefreshCw, Globe, Lock, Crown, UserPlus, Check, Ban } from "lucide-react";
import { useAuth } from "../auth/AuthProvider";
import {
  getBoardMembers,
  getInviteToken,
  listBoardAccessRequests,
  resolveBoardAccessRequest,
  removeBoardMember,
  updateBoardVisibility,
  type BoardMember,
  type BoardAccessRequest,
} from "../../services/board";

interface BoardSettingsPanelProps {
  boardId: string;
  isOwner: boolean;
  visibility: "public" | "private";
  onVisibilityChange: (v: "public" | "private") => void;
  onClose: () => void;
  onToast?: (message: string, type?: "error" | "info") => void;
  /** Called when the current user successfully removes themselves from the board. */
  onSelfRemoved?: () => void;
}

type Tab = "members" | "share";

export function BoardSettingsPanel({
  boardId,
  isOwner,
  visibility,
  onVisibilityChange,
  onClose,
  onToast,
  onSelfRemoved,
}: BoardSettingsPanelProps) {
  const { session, user } = useAuth();
  const [tab, setTab] = useState<Tab>("share");
  const [members, setMembers] = useState<BoardMember[]>([]);
  const [membersLoading, setMembersLoading] = useState(false);
  const [accessRequests, setAccessRequests] = useState<BoardAccessRequest[]>([]);
  const [requestsLoading, setRequestsLoading] = useState(false);
  const [inviteUrl, setInviteUrl] = useState<string | null>(null);
  const [inviteLoading, setInviteLoading] = useState(false);
  const [copied, setCopied] = useState<"invite" | "id" | null>(null);
  const [visibilityLoading, setVisibilityLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadMembersAndRequests = useCallback(async () => {
    setError(null);
    setMembersLoading(true);
    try {
      const loadedMembers = await getBoardMembers(boardId, session?.access_token);
      setMembers(loadedMembers);
    } catch {
      setError("Failed to load members");
    } finally {
      setMembersLoading(false);
    }

    if (isOwner && session?.access_token) {
      setRequestsLoading(true);
      try {
        const requests = await listBoardAccessRequests(boardId, session.access_token);
        setAccessRequests(requests);
      } catch {
        setError((prev) => prev ?? "Failed to load access requests");
      } finally {
        setRequestsLoading(false);
      }
    }
  }, [boardId, isOwner, session?.access_token]);

  // ── Load members / requests ───────────────────────────────────
  useEffect(() => {
    if (tab !== "members") return;
    void loadMembersAndRequests();
  }, [tab, loadMembersAndRequests]);

  // ── Load invite URL ───────────────────────────────────────────
  useEffect(() => {
    if (tab !== "share" || !session) return;
    loadInviteUrl(false);
  }, [tab, session]);

  const loadInviteUrl = useCallback(
    async (rotate: boolean) => {
      if (!session) return;
      setInviteLoading(true);
      setError(null);
      try {
        const token = await getInviteToken(boardId, session.access_token, rotate);
        const base = window.location.origin;
        setInviteUrl(`${base}/invite/${token}`);
        if (rotate) onToast?.("Invite link regenerated.", "info");
      } catch (e: any) {
        setError(e.message ?? "Failed to get invite link");
      } finally {
        setInviteLoading(false);
      }
    },
    [boardId, session, onToast]
  );

  // ── Copy invite link ──────────────────────────────────────────
  const handleCopyInvite = () => {
    if (!inviteUrl) return;
    navigator.clipboard.writeText(inviteUrl).then(() => {
      setCopied("invite");
      onToast?.("Invite link copied.", "info");
      setTimeout(() => setCopied(null), 2000);
    });
  };

  const handleCopyBoardId = () => {
    navigator.clipboard.writeText(boardId).then(() => {
      setCopied("id");
      onToast?.("Board ID copied.", "info");
      setTimeout(() => setCopied(null), 2000);
    });
  };

  // ── Change visibility ─────────────────────────────────────────
  const handleVisibilityChange = async (next: "public" | "private") => {
    if (!session || !isOwner || visibility === next) return;
    setVisibilityLoading(true);
    setError(null);
    try {
      await updateBoardVisibility(boardId, next, session.access_token);
      onVisibilityChange(next);
      onToast?.(`Board is now ${next}.`, "info");
    } catch (e: any) {
      setError(e.message ?? "Failed to update visibility");
    } finally {
      setVisibilityLoading(false);
    }
  };

  // ── Remove member ─────────────────────────────────────────────
  const handleRemove = async (userId: string) => {
    if (!session) return;
    const isSelf = userId === user?.id;
    try {
      await removeBoardMember(boardId, userId, session.access_token);
      setMembers((prev) => prev.filter((m) => m.userId !== userId));
      if (isSelf) {
        onSelfRemoved?.();
      } else {
        onToast?.("Member removed.", "info");
      }
    } catch (e: any) {
      setError(e.message ?? "Failed to remove member");
    }
  };

  const handleResolveRequest = async (requestId: string, decision: "approve" | "deny") => {
    if (!session) return;
    try {
      await resolveBoardAccessRequest(requestId, decision, session.access_token);
      setAccessRequests((prev) => prev.filter((r) => r.id !== requestId));
      if (decision === "approve") {
        onToast?.("Access request approved.", "info");
        // Refresh members to show newly added editor
        void loadMembersAndRequests();
      } else {
        onToast?.("Access request denied.", "info");
      }
    } catch (e: any) {
      setError(e.message ?? "Failed to resolve request");
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex justify-end" onClick={onClose}>
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/20 backdrop-blur-[1px]" />

      {/* Panel */}
      <div
        className="relative w-full max-w-sm bg-newsprint-bg border-l-4 border-newsprint-fg h-full shadow-[-8px_0px_0px_0px_rgba(17,17,17,0.1)] flex flex-col sharp-corners"
        onClick={(e) => e.stopPropagation()}
        style={{ animation: "slideInRight 0.18s ease-out" }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-6 border-b-4 border-newsprint-fg">
          <h2 className="text-xl font-black font-serif text-newsprint-fg uppercase tracking-widest">Board Settings</h2>
          <button
            onClick={onClose}
            className="p-1.5 sharp-corners border border-transparent hover:border-newsprint-fg text-newsprint-fg hover:bg-neutral-200 transition-colors"
          >
            <X size={18} strokeWidth={1.5} />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b-2 border-newsprint-fg px-6 bg-neutral-100">
          {(["share", "members"] as Tab[]).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`py-3 px-2 mr-6 text-xs font-mono font-bold uppercase tracking-widest border-b-4 transition-colors ${
                tab === t
                  ? "border-newsprint-fg text-newsprint-fg"
                  : "border-transparent text-newsprint-muted hover:text-newsprint-fg"
              }`}
            >
              {t === "share" ? "Share" : "Members"}
            </button>
          ))}
        </div>

        {/* Error */}
        {error && (
          <div className="mx-5 mt-4 px-3 py-2 bg-red-50 border border-red-100 text-red-600 text-sm rounded-lg">
            {error}
          </div>
        )}

        {/* ── Share tab ─────────────────────────────────────────── */}
        {tab === "share" && (
          <div className="flex-1 overflow-y-auto p-5 space-y-6">
            {/* Visibility */}
            <section>
              <h3 className="text-xs font-semibold uppercase tracking-wider text-gray-400 mb-3">
                Access
              </h3>

              <div className="grid grid-cols-2 gap-4">
                <button
                  onClick={() => handleVisibilityChange("public")}
                  disabled={!isOwner || visibilityLoading}
                  className={`flex flex-col items-center gap-2 px-3 py-4 sharp-corners border-2 transition-colors ${
                    visibility === "public"
                      ? "border-newsprint-fg bg-newsprint-fg text-newsprint-bg"
                      : "border-newsprint-muted text-newsprint-fg hover:border-newsprint-fg"
                  } ${!isOwner ? "opacity-60 cursor-not-allowed" : ""}`}
                  title={!isOwner ? "Only owners can change access" : "Set board to public"}
                >
                  <Globe size={18} strokeWidth={1.5} />
                  <span className="text-[10px] font-mono font-bold uppercase tracking-widest">Public</span>
                </button>

                <button
                  onClick={() => handleVisibilityChange("private")}
                  disabled={!isOwner || visibilityLoading}
                  className={`flex flex-col items-center gap-2 px-3 py-4 sharp-corners border-2 transition-colors ${
                    visibility === "private"
                      ? "border-newsprint-fg bg-newsprint-fg text-newsprint-bg"
                      : "border-newsprint-muted text-newsprint-fg hover:border-newsprint-fg"
                  } ${!isOwner ? "opacity-60 cursor-not-allowed" : ""}`}
                  title={!isOwner ? "Only owners can change access" : "Set board to private"}
                >
                  <Lock size={18} strokeWidth={1.5} />
                  <span className="text-[10px] font-mono font-bold uppercase tracking-widest">Private</span>
                </button>
              </div>

              <p className="text-xs font-body text-newsprint-fg mt-4 border-l-2 border-newsprint-fg pl-3">
                {visibility === "public"
                  ? "Anyone with the board link or board ID can join and edit."
                  : "Only members and approved access requests can join."}
              </p>

              {!isOwner && (
                <p className="text-xs text-amber-600 mt-2">
                  Only the board owner can change access settings.
                </p>
              )}
            </section>

            {/* Invite link */}
            <section>
              <h3 className="text-[10px] font-mono font-bold uppercase tracking-widest text-newsprint-fg mb-3 border-b border-newsprint-fg pb-1">
                Invite Link
              </h3>
              <p className="text-xs font-body text-newsprint-fg mb-4">
                {visibility === "public"
                  ? "Share this link — anyone who clicks it will be added as an editor."
                  : "Only people with this link can join. The link expires in 30 days."}
              </p>

              {inviteLoading ? (
                <div className="flex items-center justify-center py-6">
                  <div className="animate-spin w-6 h-6 border-4 border-newsprint-muted border-t-newsprint-fg rounded-full" />
                </div>
              ) : inviteUrl ? (
                <div className="space-y-3">
                  <div className="flex items-center gap-2 bg-newsprint-bg border-2 border-newsprint-fg px-3 py-3 sharp-corners shadow-[2px_2px_0px_0px_#111111]">
                    <span className="flex-1 text-xs text-newsprint-fg truncate font-mono">{inviteUrl}</span>
                    <button
                      onClick={handleCopyInvite}
                      className={`shrink-0 flex items-center gap-2 text-[10px] font-mono font-bold uppercase tracking-widest px-3 py-2 sharp-corners border-2 border-newsprint-fg transition-colors ${
                        copied === "invite"
                          ? "bg-neutral-300 text-newsprint-fg border-newsprint-muted"
                          : "bg-newsprint-fg text-newsprint-bg hover:bg-newsprint-fg/90"
                      }`}
                    >
                      <Copy size={12} strokeWidth={1.5} />
                      {copied === "invite" ? "COPIED" : "COPY"}
                    </button>
                  </div>
                  {isOwner && (
                    <button
                      onClick={() => loadInviteUrl(true)}
                      className="flex items-center gap-2 text-[10px] font-mono font-bold uppercase tracking-widest text-newsprint-fg hover:bg-neutral-200 transition-colors px-2 py-1 sharp-corners border border-transparent hover:border-newsprint-fg"
                    >
                      <RefreshCw size={12} strokeWidth={1.5} />
                      Regenerate link
                    </button>
                  )}
                </div>
              ) : null}
            </section>

            {/* Board ID */}
            <section>
              <h3 className="text-xs font-semibold uppercase tracking-wider text-gray-400 mb-3">
                Board ID
              </h3>
              <p className="text-xs text-gray-500 mb-3">
                You can also share this ID and collaborators can paste it on the dashboard Join field.
              </p>
              <div className="flex items-center gap-2 bg-gray-50 border border-gray-200 rounded-xl px-3 py-2.5">
                <span className="flex-1 text-xs text-gray-700 truncate font-mono">{boardId}</span>
                <button
                  onClick={handleCopyBoardId}
                  className={`shrink-0 flex items-center gap-1.5 text-xs font-medium px-2.5 py-1.5 rounded-lg transition ${
                    copied === "id"
                      ? "bg-emerald-100 text-emerald-700"
                      : "bg-white border border-gray-200 text-gray-600 hover:border-emerald-300 hover:text-emerald-600"
                  }`}
                >
                  <Copy size={12} />
                  {copied === "id" ? "Copied!" : "Copy"}
                </button>
              </div>
            </section>
          </div>
        )}

        {/* ── Members tab ───────────────────────────────────────── */}
        {tab === "members" && (
          <div className="flex-1 overflow-y-auto p-5">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-gray-400 mb-3">
              Members ({members.length})
            </h3>

            {membersLoading ? (
              <div className="flex items-center justify-center py-10">
                <div className="animate-spin w-5 h-5 border-2 border-indigo-400 border-t-transparent rounded-full" />
              </div>
            ) : (
              <ul className="space-y-1">
                {members.map((m) => {
                  const isMe = m.userId === user?.id;
                  // Owner can remove any non-owner; editors can only leave themselves
                  const canRemove = isOwner ? m.role !== "owner" : isMe;

                  return (
                    <li
                      key={m.userId}
                      className="flex items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-gray-50 transition"
                    >
                      {/* Avatar */}
                      <div
                        className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold text-white shrink-0"
                        style={{
                          backgroundColor: `hsl(${m.userId.charCodeAt(0) * 37 % 360}, 55%, 55%)`,
                        }}
                      >
                        {m.displayName.charAt(0).toUpperCase()}
                      </div>

                      {/* Name + role */}
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium text-gray-800 truncate flex items-center gap-1.5">
                          {m.displayName}
                          {isMe && <span className="text-xs text-gray-400">(you)</span>}
                        </div>
                        <div className="flex items-center gap-1 mt-0.5">
                          {m.role === "owner" ? (
                            <span className="flex items-center gap-1 text-xs text-amber-600 font-medium">
                              <Crown size={10} /> Owner
                            </span>
                          ) : (
                            <span className="text-xs text-gray-400">Editor</span>
                          )}
                        </div>
                      </div>

                      {/* Remove / Leave button — always visible for owners */}
                      {canRemove && (
                        <button
                          onClick={() => handleRemove(m.userId)}
                          className="shrink-0 px-2.5 py-1 rounded-lg text-xs font-medium text-red-400 border border-red-100 hover:bg-red-50 hover:text-red-600 hover:border-red-200 transition"
                          title={isMe ? "Leave board" : "Remove member"}
                        >
                          {isMe ? "Leave" : "Remove"}
                        </button>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}

            {/* Pending access requests (owner only) */}
            {isOwner && (
              <div className="mt-6">
                <h3 className="text-xs font-semibold uppercase tracking-wider text-gray-400 mb-2 flex items-center gap-1.5">
                  <UserPlus size={11} /> Access Requests ({accessRequests.length})
                </h3>

                {requestsLoading ? (
                  <div className="text-xs text-gray-400 py-2">Loading requests…</div>
                ) : accessRequests.length === 0 ? (
                  <div className="text-xs text-gray-400 py-2">No pending requests.</div>
                ) : (
                  <ul className="space-y-2">
                    {accessRequests.map((r) => (
                      <li key={r.id} className="border border-gray-200 rounded-xl p-3">
                        <div className="flex items-center justify-between gap-2">
                          <div>
                            <div className="text-sm font-medium text-gray-800">{r.requesterName}</div>
                            {r.message && (
                              <div className="text-xs text-gray-500 mt-0.5">“{r.message}”</div>
                            )}
                          </div>
                          <div className="flex items-center gap-1.5">
                            <button
                              onClick={() => handleResolveRequest(r.id, "approve")}
                              className="inline-flex items-center gap-1 px-2 py-1 text-xs rounded-lg border border-emerald-200 text-emerald-700 bg-emerald-50 hover:bg-emerald-100 transition"
                            >
                              <Check size={11} /> Approve
                            </button>
                            <button
                              onClick={() => handleResolveRequest(r.id, "deny")}
                              className="inline-flex items-center gap-1 px-2 py-1 text-xs rounded-lg border border-red-200 text-red-600 bg-red-50 hover:bg-red-100 transition"
                            >
                              <Ban size={11} /> Deny
                            </button>
                          </div>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}

            {!isOwner && members.length > 0 && (
              <p className="mt-6 text-xs text-amber-600 text-center">
                Only the board owner can remove members or approve access requests.
              </p>
            )}
          </div>
        )}
      </div>

      <style>{`
        @keyframes slideInRight {
          from { transform: translateX(100%); }
          to   { transform: translateX(0); }
        }
      `}</style>
    </div>
  );
}
