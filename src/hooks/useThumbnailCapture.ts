import { useCallback, useEffect } from "react";
import type Konva from "konva";

/**
 * Captures a JPEG thumbnail of the current canvas and saves it to localStorage.
 * Also captures automatically on unmount (SPA navigation away).
 */
export function useThumbnailCapture(
  boardId: string,
  stageRef: React.RefObject<Konva.Stage | null>
): { captureThumbnail: () => void } {
  const captureThumbnail = useCallback(() => {
    const stage = stageRef.current;
    if (!stage || !boardId) return;
    try {
      // Konva's toDataURL captures transparent pixels. JPEG converts
      // transparency → black. Fix: composite onto a white canvas first.
      const rawUrl = stage.toDataURL({ pixelRatio: 0.25 }); // PNG — preserves transparency
      const img = new Image();
      img.onload = () => {
        const cvs = document.createElement("canvas");
        cvs.width = img.width;
        cvs.height = img.height;
        const ctx = cvs.getContext("2d");
        if (!ctx) return;
        ctx.fillStyle = "#F8FAFC"; // slate-50 — matches canvas background
        ctx.fillRect(0, 0, cvs.width, cvs.height);
        ctx.drawImage(img, 0, 0);
        try {
          const dataUrl = cvs.toDataURL("image/jpeg", 0.65);
          localStorage.setItem(`collabboard-thumb-${boardId}`, dataUrl);
        } catch { /* storage full or unavailable */ }
      };
      img.src = rawUrl;
    } catch {
      // Canvas tainted or unavailable — ignore
    }
  }, [boardId, stageRef]);

  // Capture on unmount (e.g. SPA navigation away)
  useEffect(() => () => captureThumbnail(), [captureThumbnail]);

  return { captureThumbnail };
}
