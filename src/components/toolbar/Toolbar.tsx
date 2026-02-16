import { useState, useRef, useEffect } from "react";
import {
  MousePointer2,
  StickyNote,
  Square,
  Circle,
  ArrowUpRight,
  ChevronDown,
} from "lucide-react";
import type { ToolType } from "../canvas/Board";
import { getStickyColorArray, getShapeColorArray } from "../../utils/colors";

interface ToolbarProps {
  activeTool: ToolType;
  activeColor: string;
  selectedCount: number;
  onToolChange: (tool: ToolType) => void;
  onColorChange: (color: string) => void;
  onChangeSelectedColor: (color: string) => void;
}

const tools: { id: ToolType; label: string; icon: React.ReactNode; shortcut: string }[] = [
  { id: "select", label: "Select", icon: <MousePointer2 size={18} />, shortcut: "V" },
  { id: "sticky", label: "Sticky Note", icon: <StickyNote size={18} />, shortcut: "S" },
  { id: "rectangle", label: "Rectangle", icon: <Square size={18} />, shortcut: "R" },
  { id: "circle", label: "Circle", icon: <Circle size={18} />, shortcut: "C" },
  { id: "arrow", label: "Arrow", icon: <ArrowUpRight size={18} />, shortcut: "A" },
];

function ColorDropdown({
  activeColor,
  onColorChange,
  colors,
  label,
}: {
  activeColor: string;
  onColorChange: (color: string) => void;
  colors: string[];
  label: string;
}) {
  const [open, setOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1.5 px-2 py-1.5 rounded-lg hover:bg-gray-100 transition"
        title={label}
      >
        <div
          className="w-5 h-5 rounded border-2 border-gray-300"
          style={{ backgroundColor: activeColor }}
        />
        <ChevronDown size={12} className="text-gray-400" />
      </button>

      {open && (
        <div className="absolute top-full left-0 mt-1.5 bg-white rounded-lg shadow-xl border border-gray-200 p-2 z-[60] min-w-[140px]">
          <p className="text-[10px] text-gray-400 uppercase tracking-wider px-1 mb-1.5">{label}</p>
          <div className="grid grid-cols-4 gap-1.5">
            {colors.map((color) => (
              <button
                key={color}
                onClick={() => {
                  onColorChange(color);
                  setOpen(false);
                }}
                className={`w-7 h-7 rounded-md border-2 transition-transform hover:scale-110 ${
                  activeColor === color
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
  );
}

export function Toolbar({
  activeTool,
  activeColor,
  selectedCount,
  onToolChange,
  onColorChange,
  onChangeSelectedColor,
}: ToolbarProps) {
  const showCreationColor =
    activeTool === "sticky" || activeTool === "rectangle" || activeTool === "circle";

  const creationColors = activeTool === "sticky" ? getStickyColorArray() : getShapeColorArray();
  const allColors = [...new Set([...getStickyColorArray(), ...getShapeColorArray()])];

  return (
    <div className="fixed top-4 left-1/2 -translate-x-1/2 z-50 flex items-center gap-0.5 bg-white rounded-xl shadow-lg border border-gray-200 px-1.5 py-1">
      {tools.map((tool) => (
        <button
          key={tool.id}
          onClick={() => onToolChange(tool.id)}
          className={`flex items-center gap-1.5 px-2.5 py-2 rounded-lg text-sm font-medium transition ${
            activeTool === tool.id
              ? "bg-indigo-50 text-indigo-600"
              : "text-gray-500 hover:bg-gray-50 hover:text-gray-700"
          }`}
          title={`${tool.label} (${tool.shortcut})`}
        >
          {tool.icon}
          <span className="hidden lg:inline text-xs">{tool.label}</span>
        </button>
      ))}

      {/* Default color for creation tools */}
      {showCreationColor && (
        <>
          <div className="w-px h-6 bg-gray-200 mx-1" />
          <ColorDropdown
            activeColor={activeColor}
            onColorChange={onColorChange}
            colors={creationColors}
            label="Default color"
          />
        </>
      )}

      {/* Color change for selected objects */}
      {selectedCount > 0 && activeTool === "select" && (
        <>
          <div className="w-px h-6 bg-gray-200 mx-1" />
          <ColorDropdown
            activeColor=""
            onColorChange={onChangeSelectedColor}
            colors={allColors}
            label="Change color"
          />
          <span className="text-[10px] text-gray-400 px-1">{selectedCount} selected</span>
        </>
      )}
    </div>
  );
}
