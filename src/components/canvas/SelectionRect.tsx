import { Rect } from "react-konva";

interface SelectionRectProps {
  x: number;
  y: number;
  width: number;
  height: number;
  visible: boolean;
}

export function SelectionRect({ x, y, width, height, visible }: SelectionRectProps) {
  if (!visible) return null;

  return (
    <Rect
      x={Math.min(x, x + width)}
      y={Math.min(y, y + height)}
      width={Math.abs(width)}
      height={Math.abs(height)}
      fill="rgba(79, 70, 229, 0.1)"
      stroke="#4F46E5"
      strokeWidth={1}
      dash={[4, 4]}
      listening={false}
    />
  );
}
