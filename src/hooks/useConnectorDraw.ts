import { useState, useCallback, useEffect, useRef } from "react";
import type { BoardObject, Connector } from "../types/board";
import type { ToolType } from "../components/canvas/Board";

export interface ConnectorDrawState {
  fromId: string;      // "" = free point
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
  style: "arrow" | "line";
}

export interface UseConnectorDrawReturn {
  connectorDraw: ConnectorDrawState | null;
  connectorHoverObjectId: string | null;
  /** Update hover + preview on mouse move (call with canvas-space point) */
  onMouseMove: (canvasPoint: { x: number; y: number }) => void;
  /** Handle stage click for connector creation workflow */
  onStageClick: (canvasPoint: { x: number; y: number }) => boolean;
  /** Handle object click to start/complete connector */
  handleObjectClickForConnector: (id: string) => void;
  /** Cancel connector drawing (e.g. on Escape) */
  cancel: () => void;
}

export function useConnectorDraw(
  activeTool: ToolType,
  activeColor: string,
  activeStrokeWidth: number,
  objectsRef: React.MutableRefObject<Record<string, BoardObject>>,
  onCreateConnector: (conn: Omit<Connector, "id">) => string,
  onResetTool: (selectId?: string) => void
): UseConnectorDrawReturn {
  const [connectorDraw, setConnectorDraw] = useState<ConnectorDrawState | null>(null);
  const [connectorHoverObjectId, setConnectorHoverObjectId] = useState<string | null>(null);

  const isConnectorTool = activeTool === "arrow" || activeTool === "line";

  // Clear hover when tool changes away from connector tools
  useEffect(() => {
    if (!isConnectorTool) setConnectorHoverObjectId(null);
  }, [isConnectorTool]);

  const onMouseMove = useCallback(
    (canvasPoint: { x: number; y: number }) => {
      // Detect hovered object for snap visual feedback
      if (isConnectorTool) {
        let hoveredId: string | null = null;
        const objs = Object.values(objectsRef.current);
        for (let i = objs.length - 1; i >= 0; i--) {
          const o = objs[i];
          if (o.type === "frame") continue;
          const cx = o.x + o.width / 2;
          const cy = o.y + o.height / 2;
          const rad = -(o.rotation ?? 0) * (Math.PI / 180);
          const cos = Math.cos(rad);
          const sin = Math.sin(rad);
          const dx = canvasPoint.x - cx;
          const dy = canvasPoint.y - cy;
          const lx = cx + dx * cos - dy * sin;
          const ly = cy + dx * sin + dy * cos;
          if (lx >= o.x && lx <= o.x + o.width && ly >= o.y && ly <= o.y + o.height) {
            hoveredId = o.id;
            break;
          }
        }
        setConnectorHoverObjectId(hoveredId);
      }

      // Update drawing preview
      if (connectorDraw && isConnectorTool) {
        setConnectorDraw((prev) =>
          prev ? { ...prev, toX: canvasPoint.x, toY: canvasPoint.y } : null
        );
      }
    },
    [isConnectorTool, connectorDraw, objectsRef]
  );

  /** Returns true if the click was handled (consumed by connector tool) */
  const onStageClick = useCallback(
    (canvasPoint: { x: number; y: number }): boolean => {
      if (!isConnectorTool) return false;

      const style: "arrow" | "line" = activeTool === "arrow" ? "arrow" : "line";
      if (!connectorDraw) {
        setConnectorDraw({
          fromId: "",
          fromX: canvasPoint.x,
          fromY: canvasPoint.y,
          toX: canvasPoint.x,
          toY: canvasPoint.y,
          style,
        });
      } else {
        const fromPoint = connectorDraw.fromId === ""
          ? { x: connectorDraw.fromX, y: connectorDraw.fromY }
          : undefined;
        const toPoint = { x: canvasPoint.x, y: canvasPoint.y };
        onCreateConnector({
          fromId: connectorDraw.fromId,
          toId: "",
          style: connectorDraw.style,
          fromPoint,
          toPoint,
          color: activeColor,
          strokeWidth: activeStrokeWidth,
        });
        setConnectorDraw(null);
        onResetTool();
      }
      return true;
    },
    [isConnectorTool, activeTool, activeColor, activeStrokeWidth, connectorDraw, onCreateConnector, onResetTool]
  );

  const handleObjectClickForConnector = useCallback(
    (id: string) => {
      if (!isConnectorTool) return;

      const obj = objectsRef.current[id];
      if (!obj) return;

      const centerX = obj.x + obj.width / 2;
      const centerY = obj.y + obj.height / 2;
      const style: "arrow" | "line" = activeTool === "arrow" ? "arrow" : "line";

      if (!connectorDraw) {
        setConnectorDraw({
          fromId: id,
          fromX: centerX,
          fromY: centerY,
          toX: centerX,
          toY: centerY,
          style,
        });
      } else {
        if (connectorDraw.fromId === id) {
          setConnectorDraw(null);
          return;
        }
        const fromPoint = connectorDraw.fromId === ""
          ? { x: connectorDraw.fromX, y: connectorDraw.fromY }
          : undefined;
        onCreateConnector({
          fromId: connectorDraw.fromId,
          toId: id,
          style: connectorDraw.style,
          fromPoint,
          color: activeColor,
          strokeWidth: activeStrokeWidth,
        });
        setConnectorDraw(null);
        onResetTool();
      }
    },
    [isConnectorTool, activeTool, activeColor, activeStrokeWidth, connectorDraw, objectsRef, onCreateConnector, onResetTool]
  );

  const cancel = useCallback(() => {
    setConnectorDraw(null);
  }, []);

  return {
    connectorDraw,
    connectorHoverObjectId,
    onMouseMove,
    onStageClick,
    handleObjectClickForConnector,
    cancel,
  };
}
