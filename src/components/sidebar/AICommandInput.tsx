import { useState } from "react";
import type { UseAIAgentReturn } from "../../hooks/useAIAgent";
import type { AICommandResponse } from "../../types/ai";

interface AICommandInputProps {
  aiAgent: UseAIAgentReturn;
}

export function AICommandInput({ aiAgent }: AICommandInputProps) {
  const [command, setCommand] = useState("");
  const [isOpen, setIsOpen] = useState(false);
  const [history, setHistory] = useState<Array<{ command: string; response: AICommandResponse | null }>>([]);
  const { isProcessing, sendCommand } = aiAgent;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!command.trim() || isProcessing) return;

    const userCommand = command.trim();
    setCommand("");

    // Show user's message immediately (before AI responds)
    setHistory((prev) => [...prev.slice(-4), { command: userCommand, response: null }]);

    const response = await sendCommand(userCommand);

    // Replace the pending entry with the full response
    setHistory((prev) => {
      const copy = [...prev];
      let pendingIdx = -1;
      for (let j = copy.length - 1; j >= 0; j--) {
        if (copy[j].command === userCommand && copy[j].response === null) {
          pendingIdx = j;
          break;
        }
      }
      if (pendingIdx >= 0) {
        copy[pendingIdx] = { command: userCommand, response };
      } else {
        copy.push({ command: userCommand, response });
      }
      return copy;
    });
  };

  if (!isOpen) {
    return (
      <button
        onClick={() => setIsOpen(true)}
        className="fixed bottom-4 right-4 z-50 text-white rounded-full w-12 h-12 flex items-center justify-center shadow-lg transition"
        style={{ backgroundColor: "#0F2044" }}
        onMouseEnter={e => (e.currentTarget.style.opacity = "0.85")}
        onMouseLeave={e => (e.currentTarget.style.opacity = "1")}
        title="AI Assistant"
      >
        <span className="text-xl">✨</span>
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

      {/* Response area */}
      <div className="px-4 py-3 max-h-48 overflow-y-auto space-y-3">
        {history.length === 0 && !isProcessing && (
          <div className="text-xs text-gray-400 space-y-1.5">
            <p>AI-powered board commands. Try:</p>
            <ul className="space-y-1 text-gray-500">
              <li className="cursor-pointer hover:text-emerald-600" onClick={() => setCommand("Create a SWOT analysis")}>
                → "Create a SWOT analysis"
              </li>
              <li className="cursor-pointer hover:text-emerald-600" onClick={() => setCommand("Add 3 yellow sticky notes")}>
                → "Add 3 yellow sticky notes"
              </li>
              <li className="cursor-pointer hover:text-emerald-600" onClick={() => setCommand("Set up a retrospective board")}>
                → "Set up a retrospective board"
              </li>
            </ul>
          </div>
        )}

        {history.map((entry, i) => (
          <div key={i} className="space-y-1.5">
            {/* User command */}
            <div className="flex justify-end">
              <div className="bg-slate-100 text-slate-700 text-sm rounded-lg px-3 py-1.5 max-w-[85%]">
                {entry.command}
              </div>
            </div>
            {/* AI response (null = still thinking) */}
            {entry.response && (
              <div className="flex justify-start">
                <div
                  className={`text-sm rounded-lg px-3 py-1.5 max-w-[85%] ${
                    entry.response.success
                      ? "bg-green-50 text-green-700"
                      : "bg-red-50 text-red-700"
                  }`}
                >
                  <p>{entry.response.message}</p>
                  {entry.response.objectsCreated.length > 0 && (
                    <p className="text-xs opacity-70 mt-0.5">
                      {entry.response.objectsCreated.length} created
                      {entry.response.objectsUpdated && entry.response.objectsUpdated.length > 0
                        ? `, ${entry.response.objectsUpdated.length} updated`
                        : ""}
                    </p>
                  )}
                </div>
              </div>
            )}
          </div>
        ))}

        {isProcessing && (
          <div className="flex items-center gap-2 text-sm text-emerald-600">
            <div className="animate-spin h-4 w-4 border-2 border-emerald-500 border-t-transparent rounded-full" />
            <span>Thinking...</span>
          </div>
        )}
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
            placeholder="Ask AI to create or arrange..."
            className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-emerald-400 focus:border-transparent outline-none"
            disabled={isProcessing}
          />
          <button
            type="submit"
            disabled={isProcessing || !command.trim()}
            className="px-3 py-2 bg-[#0F2044] text-white rounded-lg text-sm font-medium hover:opacity-85 transition disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isProcessing ? "..." : "Send"}
          </button>
        </div>
      </form>
    </div>
  );
}
