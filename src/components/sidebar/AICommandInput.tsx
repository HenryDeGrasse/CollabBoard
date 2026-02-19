import { useState, useRef, useEffect, useCallback } from "react";
import { useAuth } from "../auth/AuthProvider";

export interface AiSnapshot {
  objects:    Record<string, unknown>;
  connectors: Record<string, unknown>;
}

interface HistoryEntry {
  command: string;
  response: string | null;
  status: "pending" | "streaming" | "done" | "error";
  toolActions?: string[];
  model?: string;
  complexity?: string;
  /** Board state captured immediately before this command was sent. */
  snapshot?: AiSnapshot;
}

// Friendly labels for tool names
const TOOL_LABELS: Record<string, string> = {
  create_objects: "Creating objects",
  create_connectors: "Adding connectors",
  update_objects: "Updating objects",
  delete_objects: "Removing objects",
  delete_connectors: "Removing connectors",
  read_board_state: "Reading board",
};

interface Viewport {
  x: number;      // stage pan X (pixels)
  y: number;      // stage pan Y (pixels)
  scale: number;  // zoom level (1 = 100%)
}

interface Props {
  boardId: string;
  viewport: Viewport;
  selectedIds?: string[];
  onNavigate?: (viewport: Viewport) => void;
  /**
   * Called immediately before the AI command is sent.
   * Must return the current board objects + connectors so the component can
   * stash the state and offer a real "undo AI change" later.
   */
  captureSnapshot?: () => AiSnapshot;
  /**
   * Called when the user clicks "Undo last AI change".
   * Receives the snapshot captured before that specific command ran.
   */
  onUndoSnapshot?: (snapshot: AiSnapshot) => void;
}

export function AICommandInput({
  boardId,
  viewport,
  selectedIds = [],
  onNavigate,
  captureSnapshot,
  onUndoSnapshot,
}: Props) {
  const { session } = useAuth();
  const [command, setCommand] = useState("");
  const [isOpen, setIsOpen] = useState(false);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  // Refs so the sendCommand closure always reads latest values without
  // recreating the callback on every selection/viewport change.
  const selectedIdsRef = useRef<string[]>(selectedIds);
  selectedIdsRef.current = selectedIds;
  const onNavigateRef = useRef(onNavigate);
  onNavigateRef.current = onNavigate;
  // Fire once per component lifetime — pings the AI endpoint on first focus
  // so the serverless function is warm before the user hits send.
  const warmupFiredRef = useRef(false);
  const handleFocus = useCallback(() => {
    if (warmupFiredRef.current) return;
    warmupFiredRef.current = true;
    const apiBase = import.meta.env.VITE_API_URL ?? "";
    fetch(`${apiBase}/api/health`).catch(() => {});
  }, []);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [history]);

  // Allow other UI surfaces to prefill/open AI (e.g. empty-board suggestion chips)
  useEffect(() => {
    const handler = (event: Event) => {
      const custom = event as CustomEvent<{ command?: string }>;
      const next = custom.detail?.command?.trim();
      if (!next) return;
      setIsOpen(true);
      setCommand(next);
    };

    window.addEventListener("collabboard:ai-prefill", handler as EventListener);
    return () => {
      window.removeEventListener("collabboard:ai-prefill", handler as EventListener);
    };
  }, []);

  const sendCommand = useCallback(
    async (userCommand: string) => {
      if (!session?.access_token) {
        setHistory((prev) => [
          ...prev.slice(-9),
          {
            command: userCommand,
            response: "Not signed in. Please log in first.",
            status: "error",
          },
        ]);
        return;
      }

      // Capture board state BEFORE the command so we can offer a real undo.
      const preCommandSnapshot = captureSnapshot?.() ?? null;

      // Snapshot completed turns BEFORE adding the new pending entry,
      // so we don't include the current in-flight request as prior context.
      // Only send "done" entries — skip errors and incomplete turns.
      // Cap at 10 prior turns to keep context size reasonable.
      const priorTurns = history
        .filter((e) => e.status === "done" && e.response)
        .slice(-10)
        .map((e) => ({ user: e.command, assistant: e.response! }));

      // Add pending entry (snapshot stored so the undo button can use it later)
      setHistory((prev) => [
        ...prev.slice(-9),
        {
          command: userCommand,
          response: "",
          status: "pending",
          toolActions: [],
          snapshot: preCommandSnapshot ?? undefined,
        },
      ]);
      setIsLoading(true);

      // Abort any previous stream
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      try {
        // Determine API base URL
        // VITE_AI_ENDPOINT lets you swap to /api/ai-vercel for the Edge experiment:
        //   VITE_AI_ENDPOINT=/api/ai-vercel npm run dev
        const apiBase = import.meta.env.VITE_API_URL || "";
        const aiPath = import.meta.env.VITE_AI_ENDPOINT || "/api/ai";
        const url = `${apiBase}${aiPath}`;

        const resp = await fetch(url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${session.access_token}`,
          },
          body: JSON.stringify({
            boardId,
            command: userCommand,
            conversationHistory: priorTurns,
            viewport,
            screenSize: {
              width: window.innerWidth,
              height: window.innerHeight,
            },
            selectedIds: selectedIdsRef.current,
          }),
          signal: controller.signal,
        });

        if (!resp.ok) {
          const errBody = await resp.json().catch(() => ({ error: "Request failed" }));
          setHistory((prev) => {
            const lastIdx = prev.length - 1;
            if (lastIdx < 0) return prev;
            const last = { ...prev[lastIdx], response: errBody.error || `Error ${resp.status}`, status: "error" as const };
            const updated = [...prev];
            updated[lastIdx] = last;
            return updated;
          });
          setIsLoading(false);
          return;
        }

        // Read SSE stream
        const reader = resp.body?.getReader();
        if (!reader) throw new Error("No response body");

        const decoder = new TextDecoder();
        let buffer = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });

          // Process complete SSE messages
          const lines = buffer.split("\n");
          buffer = lines.pop() || ""; // Keep incomplete line in buffer

          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed || !trimmed.startsWith("data: ")) continue;

            const payload = trimmed.slice(6);
            if (payload === "[DONE]") continue;

            try {
              const event = JSON.parse(payload) as {
                type: string;
                content: string;
              };

              setHistory((prev) => {
                const lastIdx = prev.length - 1;
                if (lastIdx < 0) return prev;

                // Deep-copy the last entry so React StrictMode's double-
                // invocation of state updaters doesn't mutate the original
                // and produce doubled text.
                const last = { ...prev[lastIdx] };
                const updated = [...prev];
                updated[lastIdx] = last;

                switch (event.type) {
                  case "text":
                    last.response = (last.response || "") + event.content;
                    last.status = "streaming";
                    break;

                  case "tool_start":
                    last.status = "streaming";
                    last.toolActions = [
                      ...(last.toolActions || []),
                      TOOL_LABELS[event.content] || event.content,
                    ];
                    break;

                  case "navigate": {
                    // Agent wants to pan/zoom the camera — fire and don't mutate history
                    try {
                      const vp = JSON.parse(event.content) as Viewport;
                      onNavigateRef.current?.(vp);
                    } catch { /* ignore parse errors */ }
                    return prev; // no history change needed
                  }

                  case "meta": {
                    const meta = JSON.parse(event.content) as { model: string; complexity: string };
                    last.model = meta.model;
                    last.complexity = meta.complexity;
                    break;
                  }

                  case "tool_result":
                    // Tool results are implicit — board updates via realtime
                    break;

                  case "done":
                    last.status = "done";
                    if (!last.response?.trim() && last.toolActions?.length) {
                      last.response = "✓ Done!";
                    }
                    break;

                  case "error":
                    last.response = (last.response || "") + `\n⚠️ ${event.content}`;
                    last.status = "error";
                    break;
                }

                return updated;
              });
            } catch {
              // Ignore unparseable lines
            }
          }
        }

        // Ensure final status
        setHistory((prev) => {
          const lastIdx = prev.length - 1;
          if (lastIdx < 0) return prev;
          const last = { ...prev[lastIdx] };
          if (last.status === "streaming" || last.status === "pending") {
            if (!last.response?.trim()) last.response = "✓ Done!";
            last.status = "done";
          }
          const updated = [...prev];
          updated[lastIdx] = last;
          return updated;
        });
      } catch (err: any) {
        if (err.name === "AbortError") return;
        setHistory((prev) => {
          const lastIdx = prev.length - 1;
          if (lastIdx < 0) return prev;
          const last = { ...prev[lastIdx], response: err.message || "Connection error", status: "error" as const };
          const updated = [...prev];
          updated[lastIdx] = last;
          return updated;
        });
      } finally {
        setIsLoading(false);
      }
    },
    [boardId, session, history.length]
  );

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!command.trim() || isLoading) return;

    const userCommand = command.trim();
    setCommand("");
    sendCommand(userCommand);
  };

  if (!isOpen) {
    return (
      <button
        onClick={() => setIsOpen(true)}
        aria-label="AI Assistant"
        className="fixed bottom-4 right-4 z-50 text-white rounded-full w-12 h-12 flex items-center justify-center shadow-lg transition"
        style={{ backgroundColor: "#0F2044" }}
        onMouseEnter={(e) => (e.currentTarget.style.opacity = "0.85")}
        onMouseLeave={(e) => (e.currentTarget.style.opacity = "1")}
        title="AI Assistant"
      >
        <span className="text-xl" aria-hidden>✨</span>
      </button>
    );
  }

  return (
    <div className="fixed bottom-4 right-4 z-50 bg-white rounded-xl shadow-lg border border-gray-200 w-80">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
        <div className="flex items-center gap-2">
          <span className="text-lg">✨</span>
          <span className="text-sm font-semibold text-gray-800">AI Assistant</span>
        </div>
        <button
          onClick={() => setIsOpen(false)}
          className="text-gray-400 hover:text-gray-600 text-lg"
        >
          ✕
        </button>
      </div>

      {/* History */}
      <div ref={scrollRef} className="px-4 py-3 max-h-64 overflow-y-auto space-y-3">
        {history.length === 0 && (
          <div className="text-xs text-gray-400 space-y-1.5">
            <p>AI-powered board commands. Try:</p>
            <ul className="space-y-1 text-gray-500">
              <li
                className="cursor-pointer hover:text-emerald-600"
                onClick={() => setCommand("Create a SWOT analysis")}
              >
                → "Create a SWOT analysis"
              </li>
              <li
                className="cursor-pointer hover:text-emerald-600"
                onClick={() => setCommand("Add 3 yellow sticky notes")}
              >
                → "Add 3 yellow sticky notes"
              </li>
              <li
                className="cursor-pointer hover:text-emerald-600"
                onClick={() => setCommand("Set up a retrospective board")}
              >
                → "Set up a retrospective board"
              </li>
            </ul>
          </div>
        )}

        {history.map((entry, i) => (
          <div key={i} className="space-y-1.5">
            {/* User message */}
            <div className="flex justify-end">
              <div className="bg-slate-100 text-slate-700 text-sm rounded-lg px-3 py-1.5 max-w-[85%]">
                {entry.command}
              </div>
            </div>

            {/* Tool actions indicator */}
            {entry.toolActions && entry.toolActions.length > 0 && entry.status === "streaming" && (
              <div className="flex justify-start">
                <div className="text-xs text-gray-400 flex items-center gap-1.5 px-1">
                  <span className="inline-block w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                  {entry.toolActions[entry.toolActions.length - 1]}…
                </div>
              </div>
            )}

            {/* AI response */}
            {entry.response && (
              <div className="flex justify-start flex-col gap-1">
                <div
                  className={`text-sm rounded-lg px-3 py-2 max-w-[85%] ${
                    entry.status === "error"
                      ? "bg-red-50 border border-red-200 text-red-700"
                      : "bg-emerald-50 border border-emerald-200 text-emerald-800"
                  }`}
                >
                  {entry.response}
                  {entry.status === "streaming" && (
                    <span className="inline-block w-1.5 h-4 bg-emerald-400 ml-0.5 animate-pulse align-text-bottom" />
                  )}
                </div>
                {/* Model badge — shown once response is done */}
                {entry.status === "done" && entry.model && (
                  <div className="flex items-center gap-1 px-1">
                    <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${
                      entry.complexity === "complex"
                        ? "bg-violet-100 text-violet-600"
                        : "bg-gray-100 text-gray-400"
                    }`}>
                      {entry.model}
                    </span>
                  </div>
                )}

                {/* Quick undo for last AI action — only the most recent completed
                    turn shows this. Snapshot may be null if captureSnapshot was
                    not provided; the callback receives an empty snapshot in that
                    case (safe no-op for the caller). */}
                {entry.status === "done" &&
                  onUndoSnapshot &&
                  i === history.length - 1 &&
                  (entry.toolActions?.length ?? 0) > 0 && (
                  <div className="px-1">
                    <button
                      aria-label="Undo last AI change"
                      onClick={() =>
                        onUndoSnapshot(
                          entry.snapshot ?? { objects: {}, connectors: {} }
                        )
                      }
                      className="text-[11px] text-gray-500 hover:text-gray-700 underline underline-offset-2"
                    >
                      Undo last AI change
                    </button>
                  </div>
                )}
              </div>
            )}

            {/* Pending state */}
            {entry.status === "pending" && !entry.response && (
              <div className="flex justify-start">
                <div className="text-xs text-gray-400 flex items-center gap-1.5 px-1">
                  <span className="inline-block w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                  Thinking…
                </div>
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Input */}
      <form onSubmit={handleSubmit} className="px-4 pb-3 pt-1 border-t border-gray-100">
        <div className="flex gap-2">
          <input
            id="ai-command-input"
            name="aiCommand"
            type="text"
            value={command}
            onChange={(e) => setCommand(e.target.value)}
            onFocus={handleFocus}
            placeholder={isLoading ? "Working…" : "Ask AI to create or arrange..."}
            className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-emerald-400 focus:border-transparent outline-none disabled:opacity-50"
            autoComplete="off"
            disabled={isLoading}
          />
          <button
            type="submit"
            disabled={!command.trim() || isLoading}
            className="px-3 py-2 bg-[#0F2044] text-white rounded-lg text-sm font-medium hover:opacity-85 transition disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isLoading ? (
              <span className="inline-block w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
            ) : (
              "Send"
            )}
          </button>
        </div>
      </form>
    </div>
  );
}
