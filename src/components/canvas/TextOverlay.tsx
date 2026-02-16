import { useState, useRef, useEffect, useMemo } from "react";
import type { BoardObject } from "../../types/board";
import { calculateFontSize } from "../../utils/text-fit";

interface TextOverlayProps {
  object: BoardObject;
  stageX: number;
  stageY: number;
  scale: number;
  onCommit: (id: string, text: string) => void;
  onCancel: () => void;
}

export function TextOverlay({
  object,
  stageX,
  stageY,
  scale,
  onCommit,
  onCancel,
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
      return {
        offsetX: PADDING,
        offsetY: 8, // title bar position
        innerWidth: object.width - PADDING * 2,
        innerHeight: 24, // title area only
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
  }, [object.type, object.width, object.height]);

  // Auto-fit font size
  const fontSize = useMemo(
    () =>
      calculateFontSize(
        text || "A",
        layout.innerWidth,
        layout.innerHeight,
        0,
        object.type === "frame" ? 14 : 9,
        object.type === "frame" ? 14 : 32
      ),
    [text, layout.innerWidth, layout.innerHeight, object.type]
  );

  // Determine text color based on background brightness
  const textColor = useMemo(() => {
    if (object.type === "frame") return "#374151";
    const hex = object.color.replace("#", "");
    if (hex.length < 6) return "#1F2937";
    const r = parseInt(hex.substring(0, 2), 16);
    const g = parseInt(hex.substring(2, 4), 16);
    const b = parseInt(hex.substring(4, 6), 16);
    const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
    return luminance > 0.5 ? "#1F2937" : "#FFFFFF";
  }, [object.color, object.type]);

  // Screen position
  const screenX = object.x * scale + stageX;
  const screenY = object.y * scale + stageY;

  return (
    <textarea
      ref={textareaRef}
      value={text}
      onChange={(e) => setText(e.target.value)}
      onBlur={handleBlur}
      onKeyDown={handleKeyDown}
      style={{
        position: "absolute",
        left: `${screenX + layout.offsetX * scale}px`,
        top: `${screenY + layout.offsetY * scale}px`,
        width: `${layout.innerWidth * scale}px`,
        height: `${layout.innerHeight * scale}px`,
        fontSize: `${fontSize * scale}px`,
        fontFamily: "Inter, system-ui, sans-serif",
        fontWeight: object.type === "frame" ? "bold" : "normal",
        color: textColor,
        background: "transparent",
        border: "2px solid rgba(79, 70, 229, 0.5)",
        borderRadius: `${4 * scale}px`,
        outline: "none",
        resize: "none",
        overflow: "hidden",
        zIndex: 1000,
        padding: `${2 * scale}px`,
        lineHeight: "1.4",
        textAlign: object.type === "frame" ? "left" : "center",
      }}
    />
  );
}
