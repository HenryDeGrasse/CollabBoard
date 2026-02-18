export interface FrameGestureInput {
  startX: number;
  startY: number;
  endX: number;
  endY: number;
  clickThreshold: number;
  defaultWidth: number;
  defaultHeight: number;
  minWidth: number;
  minHeight: number;
}

export interface FrameGestureResult {
  x: number;
  y: number;
  width: number;
  height: number;
  fromClick: boolean;
}

export function computeFrameFromGesture(input: FrameGestureInput): FrameGestureResult {
  const {
    startX,
    startY,
    endX,
    endY,
    clickThreshold,
    defaultWidth,
    defaultHeight,
    minWidth,
    minHeight,
  } = input;

  const dx = endX - startX;
  const dy = endY - startY;

  const isClickLike = Math.abs(dx) < clickThreshold && Math.abs(dy) < clickThreshold;

  if (isClickLike) {
    return {
      x: startX - defaultWidth / 2,
      y: startY - defaultHeight / 2,
      width: defaultWidth,
      height: defaultHeight,
      fromClick: true,
    };
  }

  return {
    x: Math.min(startX, endX),
    y: Math.min(startY, endY),
    width: Math.max(minWidth, Math.abs(dx)),
    height: Math.max(minHeight, Math.abs(dy)),
    fromClick: false,
  };
}
