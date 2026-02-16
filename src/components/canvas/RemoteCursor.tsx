import { Group, Line, Text, Rect } from "react-konva";

interface RemoteCursorProps {
  displayName: string;
  color: string;
  x: number;
  y: number;
}

export function RemoteCursor({ displayName, color, x, y }: RemoteCursorProps) {
  const CURSOR_SIZE = 16;

  return (
    <Group x={x} y={y} listening={false}>
      {/* Cursor arrow */}
      <Line
        points={[0, 0, 0, CURSOR_SIZE, CURSOR_SIZE * 0.6, CURSOR_SIZE * 0.7]}
        fill={color}
        closed
        stroke="white"
        strokeWidth={1}
      />
      {/* Name label */}
      <Group x={CURSOR_SIZE * 0.6} y={CURSOR_SIZE}>
        <Rect
          x={0}
          y={0}
          width={displayName.length * 7 + 12}
          height={20}
          fill={color}
          cornerRadius={4}
        />
        <Text
          x={6}
          y={4}
          text={displayName}
          fontSize={11}
          fontFamily="Inter, system-ui, sans-serif"
          fill="white"
        />
      </Group>
    </Group>
  );
}
