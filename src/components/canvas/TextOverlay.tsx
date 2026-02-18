import { useState, useRef, useEffect, useMemo } from "react";
import type { BoardObject } from "../../types/board";
import { calculateFontSize } from "../../utils/text-fit";
import {
  getAutoContrastingTextColor,
  getFrameHeaderHeight,
  resolveObjectTextSize,
} from "../../utils/text-style";

interface TextOverlayProps {
  object: BoardObject;
  stageX: number;
  stageY: number;
  scale: number;
  onCommit: (id: string, text: string) => void;
  onCancel: () => void;
  onDraftChange?: (text: string) => void;
}

export function TextOverlay({
  object,
  stageX,
  stageY,
  scale,
  onCommit,
  onCancel,
  onDraftChange,
}: TextOverlayProps) {
  const [text, setText] = useState(object.text || "");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.focus();
      textareaRef.current.select();
    }
  }, []);

  const handleBlur = () => {
    onCommit(object.id, text);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      onCommit(object.id, text);
    }
    if (e.key === "Escape") {
      onCancel();
    }
  };

  // Calculate padding and positioning based on object type
  const layout = useMemo(() => {
    const PADDING = object.type === "frame" ? 12 : object.type === "circle" ? 8 : 12;

    if (object.type === "circle") {
      // For circles, position text within inscribed square
      const r = Math.min(object.width, object.height) / 2;
      const side = r * Math.sqrt(2);
      const offset = (object.width - side) / 2;
      return {
        offsetX: offset + PADDING,
        offsetY: offset + PADDING,
        innerWidth: side - PADDING * 2,
        innerHeight: side - PADDING * 2,
        padding: PADDING,
      };
    }

    if (object.type === "frame") {
      const headerHeight = getFrameHeaderHeight(object);
      const innerHeight = Math.max(20, headerHeight - 8);
      const offsetY = Math.max(2, (headerHeight - innerHeight) / 2);
      return {
        offsetX: PADDING,
        offsetY,
        innerWidth: object.width - PADDING * 2,
        innerHeight,
        padding: PADDING,
      };
    }

    return {
      offsetX: PADDING,
      offsetY: PADDING,
      innerWidth: object.width - PADDING * 2,
      innerHeight: object.height - PADDING * 2,
      padding: PADDING,
    };
  }, [object]);

  // Auto-fit font size unless the object has an explicit text size override.
  const fontSize = useMemo(() => {
    if (typeof object.textSize === "number") {
      return resolveObjectTextSize(object);
    }

    return calculateFontSize(
      text || "A",
      layout.innerWidth,
      layout.innerHeight,
      0,
      object.type === "frame" ? 10 : 9,
      object.type === "frame" ? 22 : 32
    );
  }, [text, layout.innerWidth, layout.innerHeight, object]);

  // Determine text color (explicit override > auto contrast)
  const textColor = useMemo(() => {
    if (object.textColor) return object.textColor;
    if (object.type === "frame") return "#374151";
    return getAutoContrastingTextColor(object.color);
  }, [object.color, object.type, object.textColor]);

  const vAlign = object.type === "frame" ? "top" : (object.textVerticalAlign ?? "middle");

  // Screen position
  const screenX = object.x * scale + stageX;
  const screenY = object.y * scale + stageY;

  // Estimate text content height to compute vertical offset padding.
  // lineHeight ≈ fontSize * 1.4; approximate lines from text wrapping.
  const scaledFontSize = fontSize * scale;
  const lineH = scaledFontSize * 1.4;
  const boxW = layout.innerWidth * scale;
  const boxH = layout.innerHeight * scale;
  // Rough char-per-line estimate
  const charsPerLine = Math.max(1, Math.floor(boxW / (scaledFontSize * 0.55)));
  const lineCount = Math.max(1, Math.ceil((text || "A").length / charsPerLine));
  const contentH = Math.min(lineCount * lineH, boxH);

  let paddingTop = 0;
  if (vAlign === "middle") {
    paddingTop = Math.max(0, (boxH - contentH) / 2);
  } else if (vAlign === "bottom") {
    paddingTop = Math.max(0, boxH - contentH);
  }

  return (
    <textarea
      ref={textareaRef}
      value={text}
      onChange={(e) => {
        setText(e.target.value);
        onDraftChange?.(e.target.value);
      }}
      onBlur={handleBlur}
      onKeyDown={handleKeyDown}
      onMouseDown={(e) => e.stopPropagation()}
      style={{
        position: "absolute",
        left: `${screenX + layout.offsetX * scale}px`,
        top: `${screenY + layout.offsetY * scale}px`,
        width: `${boxW}px`,
        height: `${boxH}px`,
        fontSize: `${scaledFontSize}px`,
        fontFamily: "Inter, system-ui, sans-serif",
        fontWeight: object.type === "frame" ? "bold" : "normal",
        color: textColor,
        background: "transparent",
        border: "1px solid rgba(0, 0, 0, 0.25)",
        borderRadius: `${4 * scale}px`,
        outline: "none",
        resize: "none",
        overflow: "hidden",
        paddingTop: `${paddingTop}px`,
        paddingLeft: `${2 * scale}px`,
        paddingRight: `${2 * scale}px`,
        paddingBottom: `${2 * scale}px`,
        lineHeight: "1.4",
        textAlign: object.type === "frame" ? "left" : "center",
        zIndex: 1000,
        boxSizing: "border-box",
      }}
    />
  );
}
