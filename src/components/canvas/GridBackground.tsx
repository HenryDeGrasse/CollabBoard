import React, { useMemo } from "react";

interface GridBackgroundProps {
  viewportX: number;
  viewportY: number;
  viewportScale: number;
}

const GRID_IMAGE = [
  "radial-gradient(circle, rgba(100,116,139,0.42) 1.15px, transparent 1.3px)",
  "radial-gradient(circle, rgba(71,85,105,0.55) 1.4px, transparent 1.55px)",
].join(",");

export const GridBackground = React.memo(function GridBackground({
  viewportX,
  viewportY,
  viewportScale,
}: GridBackgroundProps) {
  const smallGrid = Math.max(10, 20 * viewportScale);
  const largeGrid = Math.max(50, 100 * viewportScale);

  // Use the large grid as the modulo base since both patterns must tile correctly.
  // The large grid is always a multiple of the small grid (100 vs 20 at scale=1),
  // so modding by largeGrid keeps both patterns in phase.
  const tx = ((viewportX % largeGrid) + largeGrid) % largeGrid;
  const ty = ((viewportY % largeGrid) + largeGrid) % largeGrid;

  const style = useMemo(
    () => ({
      backgroundImage: GRID_IMAGE,
      backgroundSize: `${smallGrid}px ${smallGrid}px, ${largeGrid}px ${largeGrid}px`,
      // Use transform: translate() instead of backgroundPosition for GPU
      // compositing. backgroundPosition triggers browser layout + paint on
      // every update; transform is handled by the compositor (no layout/paint).
      backgroundPosition: "0 0, 0 0",
      transform: `translate(${tx}px, ${ty}px)`,
      // Promote to own compositing layer for GPU acceleration
      willChange: "transform" as const,
      opacity: 0.72,
    }),
    [tx, ty, smallGrid, largeGrid]
  );

  return (
    <div
      className="absolute pointer-events-none"
      style={{
        ...style,
        // Extend beyond viewport so translated dots still cover the full area
        top: `-${largeGrid}px`,
        left: `-${largeGrid}px`,
        right: `-${largeGrid}px`,
        bottom: `-${largeGrid}px`,
      }}
    />
  );
});
