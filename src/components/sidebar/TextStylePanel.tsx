import React, { useEffect, useRef, useState } from "react";
import { AlignVerticalJustifyStart, AlignVerticalJustifyCenter, AlignVerticalJustifyEnd } from "lucide-react";

type VAlign = "top" | "middle" | "bottom";

interface TextStylePanelProps {
  textSize: number | null;
  textColor: string;
  textVerticalAlign: VAlign;
  onIncreaseTextSize: () => void;
  onDecreaseTextSize: () => void;
  onChangeTextColor: (color: string) => void;
  onChangeTextVerticalAlign: (align: VAlign) => void;
}

const TEXT_COLOR_OPTIONS = [
  "#111111", // Ink Black
  "#404040", // Dark Grey
  "#E5E5E0", // Muted Grey
  "#F9F9F7", // Offwhite
  "#CC0000", // Editorial Red
  "#3B82F6", // Blue
  "#22C55E", // Green
  "#FBBF24", // Yellow
];

const VALIGN_OPTIONS: { value: VAlign; icon: React.ReactNode; label: string }[] = [
  { value: "top", icon: <AlignVerticalJustifyStart size={14} />, label: "Top" },
  { value: "middle", icon: <AlignVerticalJustifyCenter size={14} />, label: "Center" },
  { value: "bottom", icon: <AlignVerticalJustifyEnd size={14} />, label: "Bottom" },
];

export const TextStylePanel = React.memo(function TextStylePanel({
  textSize,
  textColor,
  textVerticalAlign,
  onIncreaseTextSize,
  onDecreaseTextSize,
  onChangeTextColor,
  onChangeTextVerticalAlign,
}: TextStylePanelProps) {
  const [colorOpen, setColorOpen] = useState(false);
  const colorRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onMouseDown = (e: MouseEvent) => {
      if (colorRef.current && !colorRef.current.contains(e.target as Node)) {
        setColorOpen(false);
      }
    };

    document.addEventListener("mousedown", onMouseDown);
    return () => document.removeEventListener("mousedown", onMouseDown);
  }, []);

  return (
    // onMouseDown preventDefault keeps focus in the text-editing textarea
    <div className="fixed left-0 top-1/2 -translate-y-1/2 z-50" onMouseDown={(e) => e.preventDefault()}>
      <div className="bg-newsprint-bg border-2 border-l-0 border-newsprint-fg sharp-corners shadow-[4px_4px_0px_0px_#111111] p-2 flex flex-col items-center gap-2">

        <button
          onClick={onDecreaseTextSize}
          className="w-8 h-8 sharp-corners text-xs font-bold font-mono text-newsprint-fg hover:bg-neutral-200 border border-transparent hover:border-newsprint-fg transition-colors"
          title="Decrease text size"
        >
          A-
        </button>

        <div
          className="w-8 h-8 sharp-corners bg-white border border-newsprint-fg text-[10px] font-mono font-bold text-newsprint-fg flex items-center justify-center"
          title={textSize ? `Current text size: ${textSize}px` : "Mixed text sizes"}
        >
          {textSize ? `${textSize}` : "MIX"}
        </div>

        <button
          onClick={onIncreaseTextSize}
          className="w-8 h-8 sharp-corners text-xs font-bold font-mono text-newsprint-fg hover:bg-neutral-200 border border-transparent hover:border-newsprint-fg transition-colors"
          title="Increase text size"
        >
          A+
        </button>

        <div ref={colorRef} className="relative mt-1 border-t-2 border-newsprint-fg pt-2">
          <button
            onClick={() => setColorOpen((v) => !v)}
            className="w-8 h-8 sharp-corners border-2 border-newsprint-fg hover:bg-neutral-200 transition-colors"
            style={{ backgroundColor: textColor }}
            title="Text color"
          />

          {colorOpen && (
            <div className="absolute left-full top-1/2 -translate-y-1/2 ml-2 bg-newsprint-bg sharp-corners border-2 border-newsprint-fg shadow-[4px_4px_0px_0px_#111111] p-3 z-[70] w-[144px]">
              <p className="text-[10px] text-newsprint-fg font-mono font-bold uppercase tracking-widest px-1 mb-2">
                Text color
              </p>
              <div className="grid grid-cols-6 gap-1.5">
                {TEXT_COLOR_OPTIONS.map((color) => (
                  <button
                    key={color}
                    onClick={() => {
                      onChangeTextColor(color);
                      setColorOpen(false);
                    }}
                    className={`w-5 h-5 sharp-corners border-2 transition-transform hover:scale-110 ${
                      textColor === color
                        ? "border-newsprint-fg scale-110 shadow-[2px_2px_0px_0px_#111111]"
                        : "border-transparent hover:border-newsprint-fg"
                    }`}
                    style={{ backgroundColor: color }}
                    title={color}
                  />
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Vertical alignment */}
        <div className="flex flex-col gap-1 mt-1 border-t-2 border-newsprint-fg pt-2">
          {VALIGN_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              onClick={() => onChangeTextVerticalAlign(opt.value)}
              className={`w-8 h-8 sharp-corners flex items-center justify-center transition-colors border border-transparent ${
                textVerticalAlign === opt.value
                  ? "bg-newsprint-fg text-newsprint-bg border-newsprint-fg"
                  : "text-newsprint-fg hover:bg-neutral-200 hover:border-newsprint-fg"
              }`}
              title={`Align ${opt.label}`}
            >
              {opt.icon}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
});
