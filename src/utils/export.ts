import type Konva from "konva";
import type { BoardObject, Connector } from "../types/board";

/** Trigger a browser file download from a Blob. */
function triggerDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/**
 * Export the Konva stage as a PNG image with a white background.
 * Uses pixelRatio 2 for high-resolution output.
 */
export function exportAsPNG(
  stage: Konva.Stage,
  filename = "board.png",
): void {
  const rawUrl = stage.toDataURL({ pixelRatio: 2 });

  // Composite onto white background (transparency → white, not black)
  const img = new Image();
  img.onload = () => {
    const cvs = document.createElement("canvas");
    cvs.width = img.width;
    cvs.height = img.height;
    const ctx = cvs.getContext("2d");
    if (!ctx) return;
    ctx.fillStyle = "#FFFFFF";
    ctx.fillRect(0, 0, cvs.width, cvs.height);
    ctx.drawImage(img, 0, 0);

    cvs.toBlob((blob) => {
      if (blob) triggerDownload(blob, filename);
    }, "image/png");
  };
  img.src = rawUrl;
}

/**
 * Export the Konva stage as SVG.
 * If Konva's toSVG is available, use it directly.
 * Otherwise, fall back to embedding the PNG data in a minimal SVG wrapper.
 */
export function exportAsSVG(
  stage: Konva.Stage,
  filename = "board.svg",
): void {
  const stageAny = stage as any;

  if (typeof stageAny.toSVG === "function") {
    const svgString: string = stageAny.toSVG();
    const blob = new Blob([svgString], { type: "image/svg+xml;charset=utf-8" });
    triggerDownload(blob, filename);
    return;
  }

  // Fallback: embed canvas as a PNG inside an SVG wrapper
  const dataUrl = stage.toDataURL({ pixelRatio: 2 });
  const width = stage.width();
  const height = stage.height();
  const svgFallback = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
  <image href="${dataUrl}" width="${width}" height="${height}" />
</svg>`;
  const blob = new Blob([svgFallback], { type: "image/svg+xml;charset=utf-8" });
  triggerDownload(blob, filename);
}

/**
 * Export board objects and connectors as a downloadable JSON file.
 */
export function exportAsJSON(
  objects: Record<string, BoardObject>,
  connectors: Record<string, Connector>,
  boardTitle: string,
  filename = "board.json",
): void {
  const data = {
    boardTitle,
    exportedAt: new Date().toISOString(),
    objects: Object.values(objects),
    connectors: Object.values(connectors),
  };
  const json = JSON.stringify(data, null, 2);
  const blob = new Blob([json], { type: "application/json" });
  triggerDownload(blob, filename);
}
