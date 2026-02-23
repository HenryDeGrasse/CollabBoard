import React, { useRef, useEffect, useCallback } from "react";
import Konva from "konva";

interface GridBackgroundProps {
  viewportX: number;
  viewportY: number;
  viewportScale: number;
  /** Konva Stage ref — read imperatively during pan/zoom for live tracking */
  stageRef: React.RefObject<Konva.Stage | null>;
  /** True while any pan or zoom interaction is active */
  isInteracting: boolean;
}

const GRID_IMAGE = [
  "radial-gradient(circle, rgba(100,116,139,0.42) 1.15px, transparent 1.3px)",
  "radial-gradient(circle, rgba(71,85,105,0.55) 1.4px, transparent 1.55px)",
].join(",");

// Maximum zoom is 4× → largeGrid = max(50, 100*4) = 400px.
// Use this as a fixed generous extension so the grid fully covers the viewport
// at every scale, even when scale changes imperatively during zoom (before
// React state catches up).
const MAX_EXTENSION = 400;

/**
 * Apply grid position to a DOM element.  Used by both the static React path
 * and the imperative rAF loop.
 */
function applyGrid(div: HTMLDivElement, vx: number, vy: number, scale: number) {
  const smallGrid = Math.max(10, 20 * scale);
  const largeGrid = Math.max(50, 100 * scale);

  const tx = ((vx % largeGrid) + largeGrid) % largeGrid;
  const ty = ((vy % largeGrid) + largeGrid) % largeGrid;

  div.style.transform = `translate(${tx}px, ${ty}px)`;
  div.style.backgroundSize = `${smallGrid}px ${smallGrid}px, ${largeGrid}px ${largeGrid}px`;
}

/**
 * Dot-grid background that tracks the Konva Stage position in real time.
 *
 * During pan / zoom the Stage is moved imperatively (no React state updates)
 * for performance.  This component mirrors that approach: when `isInteracting`
 * is true it spins a rAF loop that reads the Stage's actual x/y/scale and
 * applies the grid directly to the DOM node — zero React renders during the
 * interaction.  When the interaction ends, React state catches up and the
 * loop stops.
 *
 * Cost: ~0.01 ms per frame (3 Konva property reads + 2 DOM style writes).
 * The element has will-change: transform so CSS transform changes are
 * handled by the GPU compositor (no layout/paint for the transform itself).
 */
export const GridBackground = React.memo(function GridBackground({
  viewportX,
  viewportY,
  viewportScale,
  stageRef,
  isInteracting,
}: GridBackgroundProps) {
  const divRef = useRef<HTMLDivElement>(null);
  const rafRef = useRef<number | null>(null);

  // ── Imperative rAF loop: active only while panning / zooming ──
  const tick = useCallback(() => {
    const stage = stageRef.current;
    const div = divRef.current;

    if (stage && div) {
      applyGrid(div, stage.x(), stage.y(), stage.scaleX());
    }

    // Always schedule next frame — the loop is stopped by the effect cleanup,
    // not by a missing stage ref (which can happen transiently during mount).
    rafRef.current = requestAnimationFrame(tick);
  }, [stageRef]);

  useEffect(() => {
    if (isInteracting) {
      // Kick off the loop — first tick fires next frame
      if (rafRef.current === null) {
        rafRef.current = requestAnimationFrame(tick);
      }
    } else {
      // Stop the loop — React state drives the grid from here
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    }

    return () => {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
  }, [isInteracting, tick]);

  // ── Static style from React state (used when NOT interacting) ──
  const smallGrid = Math.max(10, 20 * viewportScale);
  const largeGrid = Math.max(50, 100 * viewportScale);
  const tx = ((viewportX % largeGrid) + largeGrid) % largeGrid;
  const ty = ((viewportY % largeGrid) + largeGrid) % largeGrid;

  return (
    <div
      ref={divRef}
      className="absolute pointer-events-none"
      style={{
        backgroundImage: GRID_IMAGE,
        backgroundSize: `${smallGrid}px ${smallGrid}px, ${largeGrid}px ${largeGrid}px`,
        backgroundPosition: "0 0, 0 0",
        transform: `translate(${tx}px, ${ty}px)`,
        willChange: "transform",
        opacity: 0.72,
        // Fixed generous extension covers all zoom levels (max scale 4×)
        // so dots fill the viewport even when scale changes imperatively.
        top: `-${MAX_EXTENSION}px`,
        left: `-${MAX_EXTENSION}px`,
        right: `-${MAX_EXTENSION}px`,
        bottom: `-${MAX_EXTENSION}px`,
      }}
    />
  );
});
