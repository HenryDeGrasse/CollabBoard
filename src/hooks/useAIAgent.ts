import { useState, useCallback } from "react";
import type { AIResponse } from "../types/ai";
import { sendAICommand } from "../services/ai-agent";

export interface UseAIAgentReturn {
  sendCommand: (command: string) => Promise<AIResponse>;
  isProcessing: boolean;
  lastResponse: AIResponse | null;
  error: string | null;
}

export function useAIAgent(boardId: string, userId: string): UseAIAgentReturn {
  const [isProcessing, setIsProcessing] = useState(false);
  const [lastResponse, setLastResponse] = useState<AIResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const sendCommand = useCallback(
    async (command: string): Promise<AIResponse> => {
      setIsProcessing(true);
      setError(null);

      try {
        const response = await sendAICommand(command, boardId, userId);
        setLastResponse(response);
        if (!response.success) {
          setError(response.error || "Command failed");
        }
        return response;
      } catch (err) {
        const message = err instanceof Error ? err.message : "Unknown error";
        setError(message);
        const errorResponse: AIResponse = {
          success: false,
          message: "AI command failed",
          objectsCreated: [],
          objectsModified: [],
          error: message,
        };
        setLastResponse(errorResponse);
        return errorResponse;
      } finally {
        setIsProcessing(false);
      }
    },
    [boardId, userId]
  );

  return {
    sendCommand,
    isProcessing,
    lastResponse,
    error,
  };
}
