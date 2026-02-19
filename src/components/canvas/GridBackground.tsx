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

  const style = useMemo(
    () => ({
      backgroundImage: GRID_IMAGE,
      backgroundSize: `${smallGrid}px ${smallGrid}px, ${largeGrid}px ${largeGrid}px`,
      backgroundPosition: `${viewportX}px ${viewportY}px, ${viewportX}px ${viewportY}px`,
      opacity: 0.72,
    }),
    [viewportX, viewportY, smallGrid, largeGrid]
  );

  return (
    <div
      className="absolute inset-0 pointer-events-none"
      style={style}
    />
  );
});
