import type { ToolType } from "../canvas/Board";
import { ColorPicker } from "./ColorPicker";
import { getStickyColorArray, getShapeColorArray } from "../../utils/colors";

interface ToolbarProps {
  activeTool: ToolType;
  activeColor: string;
  selectedCount: number;
  onToolChange: (tool: ToolType) => void;
  onColorChange: (color: string) => void;
  onChangeSelectedColor: (color: string) => void;
}

const tools: { id: ToolType; label: string; icon: string; shortcut: string }[] = [
  { id: "select", label: "Select", icon: "🔍", shortcut: "V" },
  { id: "sticky", label: "Sticky Note", icon: "📝", shortcut: "S" },
  { id: "rectangle", label: "Rectangle", icon: "⬜", shortcut: "R" },
  { id: "circle", label: "Circle", icon: "⭕", shortcut: "C" },
  { id: "arrow", label: "Arrow", icon: "↗️", shortcut: "A" },
];

export function Toolbar({
  activeTool,
  activeColor,
  selectedCount,
  onToolChange,
  onColorChange,
  onChangeSelectedColor,
}: ToolbarProps) {
  const showCreationColorPicker =
    activeTool === "sticky" || activeTool === "rectangle" || activeTool === "circle";

  const allColors = [...new Set([...getStickyColorArray(), ...getShapeColorArray()])];

  return (
    <div className="fixed top-4 left-1/2 -translate-x-1/2 z-50 flex items-center gap-1 bg-white rounded-xl shadow-lg border border-gray-200 px-2 py-1.5">
      {tools.map((tool) => (
        <button
          key={tool.id}
          onClick={() => onToolChange(tool.id)}
          className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium transition ${
            activeTool === tool.id
              ? "bg-indigo-100 text-indigo-700"
              : "text-gray-600 hover:bg-gray-100"
          }`}
          title={`${tool.label} (${tool.shortcut})`}
        >
          <span className="text-base">{tool.icon}</span>
          <span className="hidden sm:inline">{tool.label}</span>
        </button>
      ))}

      {/* Divider + Color picker for creation tools */}
      {showCreationColorPicker && (
        <>
          <div className="w-px h-8 bg-gray-200 mx-1" />
          <ColorPicker
            activeTool={activeTool}
            activeColor={activeColor}
            onColorChange={onColorChange}
          />
        </>
      )}

      {/* Color picker for selected objects */}
      {selectedCount > 0 && activeTool === "select" && (
        <>
          <div className="w-px h-8 bg-gray-200 mx-1" />
          <div className="flex items-center gap-1.5 px-2">
            <span className="text-xs text-gray-400 mr-1">Color:</span>
            {allColors.map((color) => (
              <button
                key={color}
                onClick={() => onChangeSelectedColor(color)}
                className="w-6 h-6 rounded-full border-2 border-gray-300 transition-transform hover:scale-110 hover:border-gray-500"
                style={{ backgroundColor: color }}
                title={`Change to ${color}`}
              />
            ))}
          </div>
        </>
      )}

      {/* Pan hint */}
      <div className="w-px h-8 bg-gray-200 mx-1" />
      <div className="text-xs text-gray-400 px-2 hidden md:block">
        Space+drag to pan
      </div>
    </div>
  );
}
