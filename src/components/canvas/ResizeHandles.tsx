import { useRef } from "react";
import { Circle, Group } from "react-konva";
import Konva from "konva";
import type { BoardObject } from "../../types/board";

export type ResizeHandle =
  | "top-left"
  | "top-right"
  | "bottom-left"
  | "bottom-right"
  | "top"
  | "bottom"
  | "left"
  | "right";

const HANDLE_RADIUS = 5;
const HANDLE_STROKE = "#4F46E5";
const HANDLE_FILL = "#FFFFFF";

interface HandleDef {
  name: ResizeHandle;
  getX: (w: number, h: number) => number;
  getY: (w: number, h: number) => number;
  cursor: string;
}

const cornerHandles: HandleDef[] = [
  { name: "top-left", getX: () => 0, getY: () => 0, cursor: "nwse-resize" },
  { name: "top-right", getX: (w) => w, getY: () => 0, cursor: "nesw-resize" },
  { name: "bottom-left", getX: () => 0, getY: (_, h) => h, cursor: "nesw-resize" },
  { name: "bottom-right", getX: (w) => w, getY: (_, h) => h, cursor: "nwse-resize" },
];

const edgeHandles: HandleDef[] = [
  { name: "top", getX: (w) => w / 2, getY: () => 0, cursor: "ns-resize" },
  { name: "bottom", getX: (w) => w / 2, getY: (_, h) => h, cursor: "ns-resize" },
  { name: "left", getX: () => 0, getY: (_, h) => h / 2, cursor: "ew-resize" },
  { name: "right", getX: (w) => w, getY: (_, h) => h / 2, cursor: "ew-resize" },
];

const allHandles: HandleDef[] = [...cornerHandles, ...edgeHandles];

interface ResizeHandlesProps {
  object: BoardObject;
  circleMode?: boolean; // Only show 4 cardinal handles
  onResizeStart: () => void;
  onResizeMove: (handle: ResizeHandle, pointerX: number, pointerY: number) => void;
  onResizeEnd: () => void;
}

export function ResizeHandles({
  object,
  circleMode = false,
  onResizeStart,
  onResizeMove,
  onResizeEnd,
}: ResizeHandlesProps) {
  const activeHandleRef = useRef<ResizeHandle | null>(null);

  const handles = circleMode ? edgeHandles : allHandles;

  const handleMouseDown = (handle: HandleDef, e: Konva.KonvaEventObject<MouseEvent>) => {
    e.cancelBubble = true;
    activeHandleRef.current = handle.name;
    onResizeStart();

    const stage = e.target.getStage();
    if (!stage) return;

    const onMouseMove = () => {
      if (!activeHandleRef.current) return;
      const pointer = stage.getPointerPosition();
      if (!pointer) return;
      // Convert screen pointer to canvas coords
      const scale = stage.scaleX();
      const canvasX = (pointer.x - stage.x()) / scale;
      const canvasY = (pointer.y - stage.y()) / scale;
      onResizeMove(activeHandleRef.current, canvasX, canvasY);
    };

    const onMouseUp = () => {
      activeHandleRef.current = null;
      onResizeEnd();
      stage.off("mousemove.resize");
      stage.off("mouseup.resize");
      const container = stage.container();
      if (container) container.style.cursor = "default";
    };

    stage.on("mousemove.resize", onMouseMove);
    stage.on("mouseup.resize", onMouseUp);
  };

  return (
    <Group listening={true}>
      {handles.map((handle) => (
        <Circle
          key={handle.name}
          x={handle.getX(object.width, object.height)}
          y={handle.getY(object.width, object.height)}
          radius={HANDLE_RADIUS}
          fill={HANDLE_FILL}
          stroke={HANDLE_STROKE}
          strokeWidth={2}
          hitStrokeWidth={10}
          onMouseEnter={(e) => {
            const container = e.target.getStage()?.container();
            if (container) container.style.cursor = handle.cursor;
          }}
          onMouseLeave={(e) => {
            if (activeHandleRef.current) return; // Don't reset cursor while dragging
            const container = e.target.getStage()?.container();
            if (container) container.style.cursor = "default";
          }}
          onMouseDown={(e) => handleMouseDown(handle, e)}
        />
      ))}
    </Group>
  );
}

// Helper: compute new object bounds from a resize handle drag
export function computeResize(
  original: { x: number; y: number; width: number; height: number },
  handle: ResizeHandle,
  pointerX: number,
  pointerY: number,
  minWidth = 40,
  minHeight = 40,
  keepAspect = false
): { x: number; y: number; width: number; height: number } {
  let { x, y, width, height } = original;

  switch (handle) {
    case "top-left":
      width = original.x + original.width - pointerX;
      height = original.y + original.height - pointerY;
      x = pointerX;
      y = pointerY;
      break;
    case "top-right":
      width = pointerX - original.x;
      height = original.y + original.height - pointerY;
      y = pointerY;
      break;
    case "bottom-left":
      width = original.x + original.width - pointerX;
      height = pointerY - original.y;
      x = pointerX;
      break;
    case "bottom-right":
      width = pointerX - original.x;
      height = pointerY - original.y;
      break;
    case "top":
      height = original.y + original.height - pointerY;
      y = pointerY;
      break;
    case "bottom":
      height = pointerY - original.y;
      break;
    case "left":
      width = original.x + original.width - pointerX;
      x = pointerX;
      break;
    case "right":
      width = pointerX - original.x;
      break;
  }

  // Enforce minimums
  if (width < minWidth) {
    if (handle.includes("left")) x = original.x + original.width - minWidth;
    width = minWidth;
  }
  if (height < minHeight) {
    if (handle.includes("top") && handle !== "top-left" && handle !== "top-right") {
      y = original.y + original.height - minHeight;
    }
    if (handle === "top" || handle === "top-left" || handle === "top-right") {
      y = original.y + original.height - minHeight;
    }
    height = minHeight;
  }

  // Keep aspect ratio for circles/squares
  if (keepAspect) {
    let size: number;

    // For edge handles, use the dimension being actively resized
    if (handle === "left" || handle === "right") {
      size = width;
    } else if (handle === "top" || handle === "bottom") {
      size = height;
    } else {
      // Corner handles: use the larger dimension
      size = Math.max(width, height);
    }

    // Enforce minimum
    size = Math.max(size, Math.max(minWidth, minHeight));

    // Adjust position if resizing from left/top edges
    if (handle.includes("left")) x = original.x + original.width - size;
    if (handle.includes("top") || handle === "top") y = original.y + original.height - size;
    width = size;
    height = size;
  }

  return { x, y, width, height };
}
