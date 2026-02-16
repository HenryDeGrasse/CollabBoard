import { useState } from "react";
import type { UseAIAgentReturn } from "../../hooks/useAIAgent";

interface AICommandInputProps {
  aiAgent: UseAIAgentReturn;
}

export function AICommandInput({ aiAgent }: AICommandInputProps) {
  const [command, setCommand] = useState("");
  const [isOpen, setIsOpen] = useState(false);
  const { sendCommand, isProcessing, lastResponse, error } = aiAgent;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!command.trim() || isProcessing) return;

    await sendCommand(command.trim());
    setCommand("");
  };

  if (!isOpen) {
    return (
      <button
        onClick={() => setIsOpen(true)}
        className="fixed bottom-4 right-4 z-50 bg-indigo-600 text-white rounded-full w-12 h-12 flex items-center justify-center shadow-lg hover:bg-indigo-700 transition"
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
      <div className="px-4 py-3 max-h-40 overflow-y-auto">
        {isProcessing && (
          <div className="flex items-center gap-2 text-sm text-gray-500">
            <div className="animate-spin w-4 h-4 border-2 border-indigo-500 border-t-transparent rounded-full" />
            Processing command...
          </div>
        )}
        {!isProcessing && error && (
          <p className="text-sm text-red-500">{error}</p>
        )}
        {!isProcessing && lastResponse?.success && (
          <p className="text-sm text-green-600">{lastResponse.message}</p>
        )}
        {!isProcessing && !lastResponse && !error && (
          <p className="text-xs text-gray-400">
            Try: "Create a SWOT analysis", "Add 4 sticky notes", "Arrange in a grid"
          </p>
        )}
      </div>

      {/* Input */}
      <form onSubmit={handleSubmit} className="px-4 pb-3">
        <div className="flex gap-2">
          <input
            type="text"
            value={command}
            onChange={(e) => setCommand(e.target.value)}
            placeholder="Ask AI to create or arrange..."
            className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none"
            disabled={isProcessing}
          />
          <button
            type="submit"
            disabled={isProcessing || !command.trim()}
            className="px-3 py-2 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-700 transition disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Send
          </button>
        </div>
      </form>
    </div>
  );
}
