import { useEffect, useRef, useState } from "react";

interface TextStylePanelProps {
  textSize: number | null;
  textColor: string;
  onIncreaseTextSize: () => void;
  onDecreaseTextSize: () => void;
  onChangeTextColor: (color: string) => void;
}

const TEXT_COLOR_OPTIONS = [
  "#111827",
  "#374151",
  "#6B7280",
  "#FFFFFF",
  "#EF4444",
  "#F97316",
  "#FBBF24",
  "#22C55E",
  "#3B82F6",
  "#A855F7",
  "#EC4899",
];

export function TextStylePanel({
  textSize,
  textColor,
  onIncreaseTextSize,
  onDecreaseTextSize,
  onChangeTextColor,
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
    <div className="fixed left-0 top-1/2 -translate-y-1/2 z-50">
      <div className="bg-white/95 backdrop-blur rounded-r-xl border border-l-0 border-gray-200 shadow-md p-1.5 flex flex-col items-center gap-1.5">

        <button
          onClick={onDecreaseTextSize}
          className="w-8 h-8 rounded-lg text-xs font-semibold text-gray-600 hover:bg-gray-100 transition"
          title="Decrease text size"
        >
          A-
        </button>

        <div
          className="w-8 h-7 rounded-md bg-gray-50 border border-gray-200 text-[10px] text-gray-600 flex items-center justify-center"
          title={textSize ? `Current text size: ${textSize}px` : "Mixed text sizes"}
        >
          {textSize ? `${textSize}` : "Mix"}
        </div>

        <button
          onClick={onIncreaseTextSize}
          className="w-8 h-8 rounded-lg text-xs font-semibold text-gray-600 hover:bg-gray-100 transition"
          title="Increase text size"
        >
          A+
        </button>

        <div ref={colorRef} className="relative mt-0.5">
          <button
            onClick={() => setColorOpen((v) => !v)}
            className="w-8 h-8 rounded-lg border border-gray-300 hover:border-gray-500 transition"
            style={{ backgroundColor: textColor }}
            title="Text color"
          />

          {colorOpen && (
            <div className="absolute left-full top-1/2 -translate-y-1/2 ml-2 bg-white rounded-lg shadow-xl border border-gray-200 p-2 z-[70] w-[144px]">
              <p className="text-[10px] text-gray-400 uppercase tracking-wider px-1 mb-1.5">
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
                    className={`w-5 h-5 rounded-md border-2 transition-transform hover:scale-110 ${
                      textColor === color
                        ? "border-gray-800 scale-110 ring-1 ring-gray-800 ring-offset-1"
                        : "border-gray-200 hover:border-gray-400"
                    }`}
                    style={{ backgroundColor: color }}
                    title={color}
                  />
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
