import { Arrow, Line, Rect, Circle as KonvaCircle } from "react-konva";
import type { ConnectorDrawState } from "../../hooks/useConnectorDraw";
import type { DrawState } from "../../hooks/useDrawingTools";
import type { ToolType } from "./Board";

const MIN_FRAME_WIDTH = 200;
const MIN_FRAME_HEIGHT = 150;

interface DrawingPreviewsProps {
  connectorDraw: ConnectorDrawState | null;
  frameDraw: DrawState | null;
  shapeDraw: DrawState | null;
  activeTool: ToolType;
  activeColor: string;
  activeStrokeWidth: number;
}

export function DrawingPreviews({
  connectorDraw,
  frameDraw,
  shapeDraw,
  activeTool,
  activeColor,
  activeStrokeWidth,
}: DrawingPreviewsProps) {
  return (
    <>
      {/* Connector drawing preview (arrow or line) */}
      {connectorDraw && connectorDraw.style === "arrow" && (
        <Arrow
          points={[connectorDraw.fromX, connectorDraw.fromY, connectorDraw.toX, connectorDraw.toY]}
          stroke={activeColor}
          strokeWidth={activeStrokeWidth}
          fill={activeColor}
          pointerLength={12}
          pointerWidth={9}
          dash={[6, 4]}
          listening={false}
        />
      )}
      {connectorDraw && connectorDraw.style === "line" && (
        <Line
          points={[connectorDraw.fromX, connectorDraw.fromY, connectorDraw.toX, connectorDraw.toY]}
          stroke={activeColor}
          strokeWidth={activeStrokeWidth}
          dash={[6, 4]}
          lineCap="round"
          listening={false}
        />
      )}

      {/* Frame drawing preview */}
      {frameDraw && (
        <Rect
          x={Math.min(frameDraw.startX, frameDraw.endX)}
          y={Math.min(frameDraw.startY, frameDraw.endY)}
          width={Math.max(MIN_FRAME_WIDTH, Math.abs(frameDraw.endX - frameDraw.startX))}
          height={Math.max(MIN_FRAME_HEIGHT, Math.abs(frameDraw.endY - frameDraw.startY))}
          fill="rgba(248, 250, 252, 0.6)"
          stroke="#94A3B8"
          strokeWidth={2}
          dash={[8, 4]}
          cornerRadius={8}
          listening={false}
        />
      )}

      {/* Shape drag-to-create preview */}
      {shapeDraw && activeTool === "rectangle" && (
        <Rect
          x={Math.min(shapeDraw.startX, shapeDraw.endX)}
          y={Math.min(shapeDraw.startY, shapeDraw.endY)}
          width={Math.max(1, Math.abs(shapeDraw.endX - shapeDraw.startX))}
          height={Math.max(1, Math.abs(shapeDraw.endY - shapeDraw.startY))}
          fill={activeColor + "66"}
          stroke={activeColor}
          strokeWidth={2}
          dash={[6, 3]}
          cornerRadius={4}
          listening={false}
        />
      )}
      {shapeDraw && activeTool === "circle" && (() => {
        const side = Math.max(
          Math.abs(shapeDraw.endX - shapeDraw.startX),
          Math.abs(shapeDraw.endY - shapeDraw.startY)
        );
        const cx = (shapeDraw.startX + shapeDraw.endX) / 2;
        const cy = (shapeDraw.startY + shapeDraw.endY) / 2;
        return (
          <KonvaCircle
            x={cx}
            y={cy}
            radius={Math.max(1, side / 2)}
            fill={activeColor + "66"}
            stroke={activeColor}
            strokeWidth={2}
            dash={[6, 3]}
            listening={false}
          />
        );
      })()}

      {/* Sticky drag-to-create preview (square) */}
      {shapeDraw && activeTool === "sticky" && (() => {
        const side = Math.max(
          Math.abs(shapeDraw.endX - shapeDraw.startX),
          Math.abs(shapeDraw.endY - shapeDraw.startY)
        );
        const x = Math.min(shapeDraw.startX, shapeDraw.endX);
        const y = Math.min(shapeDraw.startY, shapeDraw.endY);
        return (
          <Rect
            x={x}
            y={y}
            width={Math.max(1, side)}
            height={Math.max(1, side)}
            fill={activeColor + "66"}
            stroke={activeColor}
            strokeWidth={2}
            dash={[6, 3]}
            cornerRadius={8}
            listening={false}
          />
        );
      })()}
    </>
  );
}
