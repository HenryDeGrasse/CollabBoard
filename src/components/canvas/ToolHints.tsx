import type { ToolType } from "./Board";

interface ToolHintsProps {
  activeTool: ToolType;
  isConnectorTool: boolean;
  isPanning: boolean;
  hasConnectorDraw: boolean;
  hasFrameDraw: boolean;
}

export function ToolHints({
  activeTool,
  isConnectorTool,
  isPanning,
  hasConnectorDraw,
  hasFrameDraw,
}: ToolHintsProps) {
  return (
    <>
      {isConnectorTool && (
        <div className="fixed bottom-16 left-1/2 -translate-x-1/2 z-50 bg-gray-800 text-white text-sm px-4 py-2 rounded-lg shadow-lg pointer-events-none">
          {hasConnectorDraw
            ? "Click to place the end point, or click an object to snap — Esc to cancel"
            : "Click to place the start point, or click an object to snap"}
        </div>
      )}

      {activeTool === "frame" && (
        <div className="fixed bottom-16 left-1/2 -translate-x-1/2 z-50 bg-gray-800 text-white text-sm px-4 py-2 rounded-lg shadow-lg pointer-events-none">
          {hasFrameDraw
            ? "Release to place frame — drag for custom size, click for default"
            : "Click for a default frame, or click-drag to size it"}
        </div>
      )}

      {isPanning && (
        <div className="fixed bottom-16 left-1/2 -translate-x-1/2 z-50 bg-gray-800 text-white text-sm px-4 py-2 rounded-lg shadow-lg pointer-events-none">
          Panning — release Space to stop
        </div>
      )}
    </>
  );
}
