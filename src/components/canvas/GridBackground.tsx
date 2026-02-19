import React from "react";

interface GridBackgroundProps {
  viewportX: number;
  viewportY: number;
  viewportScale: number;
}

export function GridBackground({ viewportX, viewportY, viewportScale }: GridBackgroundProps) {
  return (
    <div
      className="absolute inset-0 pointer-events-none"
      style={{
        backgroundImage: [
          "radial-gradient(circle, rgba(100,116,139,0.42) 1.15px, transparent 1.3px)",
          "radial-gradient(circle, rgba(71,85,105,0.55) 1.4px, transparent 1.55px)",
        ].join(","),
        backgroundSize: `${Math.max(10, 20 * viewportScale)}px ${Math.max(10, 20 * viewportScale)}px, ${Math.max(50, 100 * viewportScale)}px ${Math.max(50, 100 * viewportScale)}px`,
        backgroundPosition: `${viewportX}px ${viewportY}px, ${viewportX}px ${viewportY}px`,
        opacity: 0.72,
      }}
    />
  );
}
