import React, { useState, useRef, useEffect, useCallback } from "react";
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
  /** Compact summary of tool results for follow-up context. */
  toolSummary?: string;
  model?: string;
  complexity?: string;
  /** Board state captured immediately before this command was sent. */
  snapshot?: AiSnapshot;
}

// Friendly labels for tool names
const TOOL_LABELS: Record<string, string> = {
  create_objects: "Creating objects",
  bulk_create_objects: "Creating objects",
  create_connectors: "Adding connectors",
  update_objects: "Updating objects",
  update_objects_by_filter: "Updating objects",
  delete_objects: "Removing objects",
  delete_objects_by_filter: "Removing objects",
  delete_connectors: "Removing connectors",
  read_board_state: "Reading board",
  search_objects: "Searching board",
  get_board_context: "Reading board context",
  clear_board: "Clearing board",
  navigate_to_objects: "Navigating",
  arrange_objects: "Arranging objects",
  duplicate_objects: "Duplicating objects",
  fit_frames_to_contents: "Fitting frames",
  createQuadrant: "Building quadrant layout",
  createColumnLayout: "Building column layout",
  createWireframe: "Building wireframe",
  createMindMap: "Building mind map",
  createFlowchart: "Building flowchart",
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

export const AICommandInput = React.memo(function AICommandInput({
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
  const viewportRef = useRef(viewport);
  viewportRef.current = viewport;
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
        .map((e) => ({
          user: e.command,
          assistant: e.response! + (e.toolSummary ? `\n[Actions: ${e.toolSummary.trim()}]` : ""),
        }));

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
        const apiBase = import.meta.env.VITE_API_URL || "";
        const url = `${apiBase}/api/ai`;

        const commandId = crypto.randomUUID();

        let resp = await fetch(url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${session.access_token}`,
          },
          body: JSON.stringify({
            boardId,
            command: userCommand,
            commandId,
            conversationHistory: priorTurns,
            viewport: viewportRef.current,
            screenSize: {
              width: window.innerWidth,
              height: window.innerHeight,
            },
            selectedIds: selectedIdsRef.current,
          }),
          signal: controller.signal,
        });

        if (!resp.ok && resp.status === 409) {
          const inProgress = await resp.json().catch(() => ({} as any));
          const resumeId = typeof inProgress.commandId === "string" ? inProgress.commandId : commandId;

          resp = await fetch(`${apiBase}/api/ai-continue`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${session.access_token}`,
            },
            body: JSON.stringify({
              boardId,
              commandId: resumeId,
            }),
            signal: controller.signal,
          });
        }

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

              // Handle navigate outside the state updater to avoid
              // triggering setState on BoardPage during our own update.
              if (event.type === "navigate") {
                try {
                  const vp = JSON.parse(event.content) as Viewport;
                  onNavigateRef.current?.(vp);
                } catch { /* ignore parse errors */ }
                continue;
              }

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

                  case "meta": {
                    const meta = JSON.parse(event.content) as { model: string; complexity: string };
                    last.model = meta.model;
                    last.complexity = meta.complexity;
                    break;
                  }

                  case "tool_result": {
                    // Capture compact summary for follow-up conversation context
                    try {
                      const parsed = JSON.parse(event.content) as { tool: string; result: any };
                      const msg = parsed.result?.message ?? "";
                      const summary = `${parsed.tool}: ${typeof msg === "string" ? msg.slice(0, 120) : JSON.stringify(parsed.result).slice(0, 120)}`;
                      last.toolSummary = ((last.toolSummary || "") + summary + "; ").slice(0, 500);
                    } catch { /* ignore parse errors */ }
                    break;
                  }

                  case "plan_ready": {
                    try {
                      const plan = JSON.parse(event.content) as { steps?: Array<{ label?: string }> };
                      if (Array.isArray(plan.steps) && plan.steps.length > 0) {
                        const label = plan.steps[0]?.label ? `Plan: ${plan.steps[0].label}` : "Plan ready";
                        last.toolActions = [...(last.toolActions || []), label];
                      }
                    } catch {
                      last.toolActions = [...(last.toolActions || []), "Plan ready"];
                    }
                    last.status = "streaming";
                    break;
                  }

                  case "step_started": {
                    try {
                      const step = JSON.parse(event.content) as { tool?: string };
                      const label = step.tool ? `Running ${step.tool}` : "Running step";
                      last.toolActions = [...(last.toolActions || []), label];
                    } catch {
                      last.toolActions = [...(last.toolActions || []), "Running step"];
                    }
                    last.status = "streaming";
                    break;
                  }

                  case "step_succeeded":
                    // Keep the latest running label; no-op beyond status update.
                    last.status = "streaming";
                    break;

                  case "step_failed": {
                    try {
                      const step = JSON.parse(event.content) as { tool?: string; error?: string };
                      const failLabel = step.tool
                        ? `${step.tool} failed${step.error ? `: ${step.error}` : ""}`
                        : "Step failed";
                      last.toolActions = [...(last.toolActions || []), failLabel];
                    } catch {
                      last.toolActions = [...(last.toolActions || []), "Step failed"];
                    }
                    last.status = "streaming";
                    break;
                  }

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
        className="fixed bottom-4 right-4 z-50 bg-newsprint-fg text-newsprint-bg sharp-corners w-12 h-12 flex items-center justify-center border-2 border-newsprint-fg shadow-[4px_4px_0px_0px_#111111] hover:bg-white hover:text-newsprint-fg transition-colors duration-200"
        title="AI Assistant"
      >
        <span className="text-lg font-mono font-bold" aria-hidden>AI</span>
      </button>
    );
  }

  return (
    <div className="fixed bottom-4 right-4 z-50 bg-newsprint-bg border-2 border-newsprint-fg sharp-corners shadow-[6px_6px_0px_0px_#111111] w-80">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b-2 border-newsprint-fg">
        <span className="text-xs font-mono font-bold uppercase tracking-widest text-newsprint-fg">AI Assistant</span>
        <button
          onClick={() => setIsOpen(false)}
          className="text-newsprint-fg hover:bg-neutral-200 px-2 py-1 sharp-corners border border-transparent hover:border-newsprint-fg transition-colors"
        >
          ✕
        </button>
      </div>

      {/* History */}
      <div ref={scrollRef} className="px-4 py-3 max-h-64 overflow-y-auto space-y-3">
        {history.length === 0 && (
          <div className="text-[10px] font-mono font-bold uppercase tracking-widest text-newsprint-fg space-y-2">
            <p>AI-powered board commands. Try:</p>
            <ul className="space-y-2 text-neutral-600">
              <li
                className="cursor-pointer hover:text-newsprint-fg hover:bg-neutral-200 px-2 py-1 sharp-corners border border-transparent hover:border-newsprint-fg transition-colors"
                onClick={() => setCommand("Create a SWOT analysis")}
              >
                → Create a SWOT analysis
              </li>
              <li
                className="cursor-pointer hover:text-newsprint-fg hover:bg-neutral-200 px-2 py-1 sharp-corners border border-transparent hover:border-newsprint-fg transition-colors"
                onClick={() => setCommand("Add 3 yellow sticky notes")}
              >
                → Add 3 yellow sticky notes
              </li>
              <li
                className="cursor-pointer hover:text-newsprint-fg hover:bg-neutral-200 px-2 py-1 sharp-corners border border-transparent hover:border-newsprint-fg transition-colors"
                onClick={() => setCommand("Set up a retrospective board")}
              >
                → Set up a retrospective board
              </li>
            </ul>
          </div>
        )}

        {history.map((entry, i) => (
          <div key={i} className="space-y-1.5">
            {/* User message */}
            <div className="flex justify-end">
              <div className="bg-neutral-200 text-newsprint-fg text-xs font-mono px-3 py-1.5 max-w-[85%] sharp-corners border border-newsprint-fg">
                {entry.command}
              </div>
            </div>

            {/* Tool actions indicator */}
            {entry.toolActions && entry.toolActions.length > 0 && entry.status === "streaming" && (
              <div className="flex justify-start">
                <div className="text-[10px] font-mono font-bold uppercase tracking-widest text-newsprint-fg flex items-center gap-2 px-1">
                  <span className="inline-block w-2 h-2 sharp-corners bg-newsprint-fg animate-pulse" />
                  {entry.toolActions[entry.toolActions.length - 1]}…
                </div>
              </div>
            )}

            {/* AI response */}
            {entry.response && (
              <div className="flex justify-start flex-col gap-1">
                <div
                  className={`text-xs font-body px-3 py-2 max-w-[85%] sharp-corners border ${
                    entry.status === "error"
                      ? "bg-newsprint-accent/10 border-newsprint-accent text-newsprint-fg"
                      : "bg-neutral-100 border-newsprint-fg text-newsprint-fg"
                  }`}
                >
                  {entry.response}
                  {entry.status === "streaming" && (
                    <span className="inline-block w-1.5 h-4 bg-newsprint-fg ml-0.5 animate-pulse align-text-bottom" />
                  )}
                </div>
                {/* Model badge — shown once response is done */}
                {entry.status === "done" && entry.model && (
                  <div className="flex items-center gap-1 px-1">
                    <span className={`text-[10px] px-1.5 py-0.5 sharp-corners font-mono font-bold uppercase tracking-widest ${
                      entry.complexity === "complex"
                        ? "bg-newsprint-fg text-newsprint-bg border border-newsprint-fg"
                        : "bg-neutral-200 text-newsprint-fg border border-newsprint-fg"
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
                      className="text-[10px] font-mono font-bold uppercase tracking-widest text-newsprint-fg hover:text-newsprint-accent underline underline-offset-2 decoration-newsprint-accent"
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
                <div className="text-[10px] font-mono font-bold uppercase tracking-widest text-newsprint-fg flex items-center gap-2 px-1">
                  <span className="inline-block w-2 h-2 sharp-corners bg-newsprint-fg animate-pulse" />
                  Thinking…
                </div>
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Input */}
      <form onSubmit={handleSubmit} className="px-4 pb-4 pt-3 border-t-2 border-newsprint-fg">
        <div className="flex gap-2">
          <input
            id="ai-command-input"
            name="aiCommand"
            type="text"
            value={command}
            onChange={(e) => setCommand(e.target.value)}
            onFocus={handleFocus}
            placeholder={isLoading ? "Working…" : "Ask AI to create or arrange..."}
            className="flex-1 px-3 py-2 border-b-2 border-newsprint-fg bg-transparent text-newsprint-fg text-sm font-mono focus-visible:bg-neutral-100 focus-visible:outline-none sharp-corners placeholder:text-neutral-500 disabled:opacity-50"
            autoComplete="off"
            disabled={isLoading}
          />
          <button
            type="submit"
            disabled={!command.trim() || isLoading}
            className="px-4 py-2 bg-newsprint-fg text-newsprint-bg border border-transparent hover:bg-white hover:text-newsprint-fg hover:border-newsprint-fg sharp-corners text-xs font-mono font-bold uppercase tracking-widest transition-colors duration-200 disabled:opacity-50 disabled:cursor-not-allowed"
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
});
