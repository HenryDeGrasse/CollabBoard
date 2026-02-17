import { useState, useCallback } from "react";
import type { AICommandResponse, Viewport } from "../types/ai";
import { sendAICommand } from "../services/ai-agent";
import type Konva from "konva";

export interface UseAIAgentReturn {
  sendCommand: (command: string) => Promise<AICommandResponse>;
  isProcessing: boolean;
  lastResponse: AICommandResponse | null;
  error: string | null;
}

/**
 * Compute viewport bounds from the Konva stage in canvas coordinates.
 */
export function computeViewport(stage: Konva.Stage): Viewport {
  const rect = stage.container().getBoundingClientRect();
  const sx = stage.scaleX();
  const sy = stage.scaleY();

  const minX = -stage.x() / sx;
  const minY = -stage.y() / sy;
  const maxX = (-stage.x() + rect.width) / sx;
  const maxY = (-stage.y() + rect.height) / sy;

  return {
    minX,
    minY,
    maxX,
    maxY,
    centerX: (minX + maxX) / 2,
    centerY: (minY + maxY) / 2,
    scale: sx,
  };
}

export function useAIAgent(
  boardId: string,
  stageRef: React.RefObject<Konva.Stage | null>,
  selectedIds: Set<string>
): UseAIAgentReturn {
  const [isProcessing, setIsProcessing] = useState(false);
  const [lastResponse, setLastResponse] = useState<AICommandResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const sendCommand = useCallback(
    async (command: string): Promise<AICommandResponse> => {
      setIsProcessing(true);
      setError(null);

      try {
        // Compute viewport from current stage state
        const stage = stageRef.current;
        const viewport: Viewport = stage
          ? computeViewport(stage)
          : { minX: 0, minY: 0, maxX: 1920, maxY: 1080, centerX: 960, centerY: 540, scale: 1 };

        const response = await sendAICommand({
          boardId,
          command,
          viewport,
          selectedObjectIds: Array.from(selectedIds),
        });

        setLastResponse(response);
        if (!response.success) {
          setError(response.error || "Command failed");
        }
        return response;
      } catch (err) {
        const message = err instanceof Error ? err.message : "Unknown error";
        setError(message);
        const errorResponse: AICommandResponse = {
          success: false,
          message: "AI command failed",
          objectsCreated: [],
          objectsUpdated: [],
          objectsDeleted: [],
          runId: "",
          error: message,
        };
        setLastResponse(errorResponse);
        return errorResponse;
      } finally {
        setIsProcessing(false);
      }
    },
    [boardId, stageRef, selectedIds]
  );

  return {
    sendCommand,
    isProcessing,
    lastResponse,
    error,
  };
}
