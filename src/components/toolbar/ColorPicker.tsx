import { getStickyColorArray, getShapeColorArray } from "../../utils/colors";
import type { ToolType } from "../canvas/Board";

interface ColorPickerProps {
  activeTool: ToolType;
  activeColor: string;
  onColorChange: (color: string) => void;
}

export function ColorPicker({ activeTool, activeColor, onColorChange }: ColorPickerProps) {
  const colors = activeTool === "sticky" ? getStickyColorArray() : getShapeColorArray();

  return (
    <div className="flex items-center gap-1.5 px-2">
      {colors.map((color) => (
        <button
          key={color}
          onClick={() => onColorChange(color)}
          className={`w-6 h-6 rounded-full border-2 transition-transform hover:scale-110 ${
            activeColor === color
              ? "border-gray-800 scale-110"
              : "border-gray-300"
          }`}
          style={{ backgroundColor: color }}
          title={color}
        />
      ))}
    </div>
  );
}
