import { describe, it, expect } from "vitest";
import { computeFrameFromGesture } from "../../utils/frame";

describe("frame create gesture", () => {
  it("creates a default-sized frame centered on click when movement is tiny", () => {
    const frame = computeFrameFromGesture({
      startX: 100,
      startY: 200,
      endX: 102,
      endY: 201,
      clickThreshold: 6,
      defaultWidth: 200,
      defaultHeight: 150,
      minWidth: 200,
      minHeight: 150,
    });

    expect(frame).toEqual({
      x: 0,
      y: 125,
      width: 200,
      height: 150,
      fromClick: true,
    });
  });

  it("creates frame from drag bounds when movement exceeds threshold", () => {
    const frame = computeFrameFromGesture({
      startX: 100,
      startY: 200,
      endX: 360,
      endY: 420,
      clickThreshold: 6,
      defaultWidth: 200,
      defaultHeight: 150,
      minWidth: 200,
      minHeight: 150,
    });

    expect(frame).toEqual({
      x: 100,
      y: 200,
      width: 260,
      height: 220,
      fromClick: false,
    });
  });

  it("uses min size for short drags", () => {
    const frame = computeFrameFromGesture({
      startX: 400,
      startY: 300,
      endX: 450,
      endY: 330,
      clickThreshold: 6,
      defaultWidth: 200,
      defaultHeight: 150,
      minWidth: 200,
      minHeight: 150,
    });

    expect(frame).toEqual({
      x: 400,
      y: 300,
      width: 200,
      height: 150,
      fromClick: false,
    });
  });

  it("handles reverse drag direction", () => {
    const frame = computeFrameFromGesture({
      startX: 500,
      startY: 500,
      endX: 260,
      endY: 260,
      clickThreshold: 6,
      defaultWidth: 200,
      defaultHeight: 150,
      minWidth: 200,
      minHeight: 150,
    });

    expect(frame).toEqual({
      x: 260,
      y: 260,
      width: 240,
      height: 240,
      fromClick: false,
    });
  });
});
