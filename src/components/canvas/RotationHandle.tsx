import { useRef } from "react";
import { Circle, Line, Group } from "react-konva";
import Konva from "konva";

const HANDLE_RADIUS = 6;
const HANDLE_OFFSET_Y = -28; // distance above the object
const HANDLE_FILL = "#FFFFFF";
const HANDLE_STROKE = "#4F46E5";

interface RotationHandleProps {
  objectWidth: number;
  objectHeight: number;
  /** Current rotation in degrees (used only for cursor feedback) */
  rotation: number;
  onRotateStart: () => void;
  onRotateMove: (angleDeg: number, shiftKey: boolean) => void;
  onRotateEnd: () => void;
}

/**
 * A small circular handle rendered above the selected object.
 * Drag it to rotate. Shift-drag snaps to 15° increments.
 *
 * Coordinates are in the object's LOCAL space (pre-rotation).
 * The parent Group applies the rotation transform.
 */
export function RotationHandle({
  objectWidth,
  objectHeight,
  onRotateStart,
  onRotateMove,
  onRotateEnd,
}: RotationHandleProps) {
  const rotatingRef = useRef(false);

  const cx = objectWidth / 2;
  const handleY = HANDLE_OFFSET_Y;

  const handleMouseDown = (e: Konva.KonvaEventObject<MouseEvent>) => {
    e.cancelBubble = true;
    rotatingRef.current = true;
    onRotateStart();

    const stage = e.target.getStage();
    if (!stage) return;

    const container = stage.container();
    if (container) container.style.cursor = "grabbing";

    const onMouseMove = (moveEvt: Konva.KonvaEventObject<MouseEvent>) => {
      if (!rotatingRef.current) return;
      const pointer = stage.getPointerPosition();
      if (!pointer) return;

      // Object center in canvas coordinates.
      // The object Group is positioned at (object.x, object.y) and has
      // offset (w/2, h/2), so its absolute center is at
      // stage.x + (object center) * scale.
      // But the simplest way is to get the group's absolute transform.
      const group = e.target.findAncestor("Group");
      if (!group) return;

      const absTransform = group.getAbsoluteTransform();
      // Center of the object in local space is (w/2, h/2)
      const centerLocal = { x: objectWidth / 2, y: objectHeight / 2 };
      const centerAbs = absTransform.point(centerLocal);

      // Angle from center to pointer (in screen pixels)
      const dx = pointer.x - centerAbs.x;
      const dy = pointer.y - centerAbs.y;
      const angleRad = Math.atan2(dy, dx);
      // Convert to degrees. atan2 gives 0° = right, we want 0° = up.
      let angleDeg = (angleRad * 180) / Math.PI + 90;

      onRotateMove(angleDeg, moveEvt.evt.shiftKey);
    };

    const onMouseUp = () => {
      rotatingRef.current = false;
      onRotateEnd();
      stage.off("mousemove.rotate");
      stage.off("mouseup.rotate");
      if (container) container.style.cursor = "default";
    };

    stage.on("mousemove.rotate", onMouseMove);
    stage.on("mouseup.rotate", onMouseUp);
  };

  return (
    <Group listening={true}>
      {/* Stem line from top-center of object to handle */}
      <Line
        points={[cx, 0, cx, handleY + HANDLE_RADIUS]}
        stroke={HANDLE_STROKE}
        strokeWidth={1.5}
        dash={[3, 3]}
        listening={false}
      />
      {/* Handle circle */}
      <Circle
        x={cx}
        y={handleY}
        radius={HANDLE_RADIUS}
        fill={HANDLE_FILL}
        stroke={HANDLE_STROKE}
        strokeWidth={2}
        hitStrokeWidth={14}
        onMouseEnter={(e) => {
          const container = e.target.getStage()?.container();
          if (container) container.style.cursor = "grab";
        }}
        onMouseLeave={(e) => {
          if (rotatingRef.current) return;
          const container = e.target.getStage()?.container();
          if (container) container.style.cursor = "default";
        }}
        onMouseDown={handleMouseDown}
      />
    </Group>
  );
}
