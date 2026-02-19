import { useState, useRef, useEffect } from "react";
import {
  MousePointer2,
  StickyNote,
  Square,
  Circle,
  ArrowUpRight,
  Minus,
  Frame,
  ChevronDown,
} from "lucide-react";
import type Konva from "konva";
import type { ToolType } from "../canvas/Board";
import type { BoardObject, Connector } from "../../types/board";
import { getStickyColorArray, getShapeColorArray } from "../../utils/colors";
import { ExportMenu } from "../ui/ExportMenu";

interface ToolbarProps {
  activeTool: ToolType;
  activeColor: string;
  activeStrokeWidth: number;
  selectedCount: number;
  selectedColor: string;
  selectedStrokeWidth: number | null;
  /** Number of selected connectors */
  selectedConnectorCount: number;
  /** Common color of selected connectors (null if mixed) */
  selectedConnectorColor: string | null;
  /** Common stroke width of selected connectors (null if mixed) */
  selectedConnectorStrokeWidth: number | null;
  onToolChange: (tool: ToolType) => void;
  onColorChange: (color: string) => void;
  onStrokeWidthChange: (w: number) => void;
  onChangeSelectedColor: (color: string) => void;
  onChangeSelectedStrokeWidth: (w: number) => void;
  onChangeSelectedConnectorColor: (color: string) => void;
  stageRef?: React.RefObject<Konva.Stage | null>;
  objects?: Record<string, BoardObject>;
  connectors?: Record<string, Connector>;
  boardTitle?: string;
}

const tools: { id: ToolType; label: string; icon: React.ReactNode; shortcut: string }[] = [
  { id: "select", label: "Select", icon: <MousePointer2 size={18} />, shortcut: "V" },
  { id: "sticky", label: "Sticky Note", icon: <StickyNote size={18} />, shortcut: "S" },
  { id: "rectangle", label: "Rectangle", icon: <Square size={18} />, shortcut: "R" },
  { id: "circle", label: "Circle", icon: <Circle size={18} />, shortcut: "C" },
  { id: "arrow", label: "Arrow", icon: <ArrowUpRight size={18} />, shortcut: "A" },
  { id: "line", label: "Line", icon: <Minus size={18} />, shortcut: "L" },
  { id: "frame", label: "Frame", icon: <Frame size={18} />, shortcut: "F" },
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
        <div className="absolute bottom-full left-0 mb-1.5 bg-white rounded-lg shadow-xl border border-gray-200 p-2 z-[60] min-w-[140px]">
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

const STROKE_WIDTHS = [1, 2, 3, 5, 8];

function StrokeWidthPicker({
  value,
  onChange,
  label,
}: {
  value: number;
  onChange: (w: number) => void;
  label: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1.5 px-2 py-1.5 rounded-lg hover:bg-gray-100 transition"
        title={label}
      >
        {/* Stroke preview */}
        <div className="w-5 h-5 flex items-center justify-center">
          <div className="rounded-full bg-gray-600" style={{ width: 16, height: Math.max(2, value) }} />
        </div>
        <ChevronDown size={12} className="text-gray-400" />
      </button>

      {open && (
        <div className="absolute bottom-full left-0 mb-1.5 bg-white rounded-lg shadow-xl border border-gray-200 p-2 z-[60] min-w-[100px]">
          <p className="text-[10px] text-gray-400 uppercase tracking-wider px-1 mb-1.5">{label}</p>
          <div className="space-y-1">
            {STROKE_WIDTHS.map((w) => (
              <button
                key={w}
                onClick={() => { onChange(w); setOpen(false); }}
                className={`w-full flex items-center gap-2 px-2 py-1.5 rounded hover:bg-gray-50 transition ${
                  value === w ? "bg-emerald-50" : ""
                }`}
              >
                <div className="w-8 flex items-center justify-center">
                  <div className="rounded-full bg-gray-700" style={{ width: 24, height: Math.max(1, w) }} />
                </div>
                <span className="text-xs text-gray-500">{w}px</span>
              </button>
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
  activeStrokeWidth,
  selectedCount,
  selectedColor,
  selectedStrokeWidth,
  selectedConnectorCount,
  selectedConnectorColor,
  selectedConnectorStrokeWidth,
  onToolChange,
  onColorChange,
  onStrokeWidthChange,
  onChangeSelectedColor,
  onChangeSelectedStrokeWidth,
  onChangeSelectedConnectorColor,
  stageRef,
  objects,
  connectors,
  boardTitle,
}: ToolbarProps) {
  const isConnectorTool = activeTool === "arrow" || activeTool === "line";
  const showCreationColor =
    activeTool === "sticky" || activeTool === "rectangle" || activeTool === "circle" || isConnectorTool;

  const creationColors = activeTool === "sticky" ? getStickyColorArray() : getShapeColorArray();
  const allColors = [...new Set([...getStickyColorArray(), ...getShapeColorArray()])];

  return (
    <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 flex items-center gap-0.5 bg-white rounded-xl shadow-lg border border-gray-200 px-1.5 py-1">
      {tools.map((tool) => (
        <button
          key={tool.id}
          onClick={() => onToolChange(tool.id)}
          className={`group h-10 flex items-center rounded-lg transition-colors duration-150 ${
            activeTool === tool.id
              ? "bg-emerald-50 text-emerald-600"
              : "text-gray-500 hover:bg-gray-50 hover:text-gray-700"
          }`}
          title={`${tool.label} (${tool.shortcut})`}
          aria-label={`${tool.label} (${tool.shortcut})`}
        >
          <span className="w-10 h-10 flex items-center justify-center shrink-0">
            {tool.icon}
          </span>
          <span className="text-xs whitespace-nowrap overflow-hidden max-w-0 group-hover:max-w-[160px] transition-[max-width,padding-right] duration-300 ease-in-out pr-0 group-hover:pr-3">
            {tool.label}
          </span>
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

      {/* Stroke width for connector tools (arrow / line) */}
      {isConnectorTool && (
        <StrokeWidthPicker
          value={activeStrokeWidth}
          onChange={onStrokeWidthChange}
          label="Stroke width"
        />
      )}

      {/* Style controls for selected objects */}
      {selectedCount > 0 && activeTool === "select" && (
        <>
          <div className="w-px h-6 bg-gray-200 mx-1" />
          <ColorDropdown
            activeColor={selectedColor}
            onColorChange={onChangeSelectedColor}
            colors={allColors}
            label="Fill color"
          />

          {/* Stroke width for selected lines */}
          {selectedStrokeWidth !== null && (
            <StrokeWidthPicker
              value={selectedStrokeWidth}
              onChange={onChangeSelectedStrokeWidth}
              label="Stroke width"
            />
          )}

          <span className="text-[10px] text-gray-400 px-1">{selectedCount} selected</span>
        </>
      )}

      {/* Style controls for selected connectors (arrows / lines) */}
      {selectedConnectorCount > 0 && activeTool === "select" && (
        <>
          {selectedCount === 0 && <div className="w-px h-6 bg-gray-200 mx-1" />}
          <ColorDropdown
            activeColor={selectedConnectorColor ?? "#4B5563"}
            onColorChange={onChangeSelectedConnectorColor}
            colors={allColors}
            label="Connector color"
          />
          <StrokeWidthPicker
            value={selectedConnectorStrokeWidth ?? 2.5}
            onChange={onChangeSelectedStrokeWidth}
            label="Connector thickness"
          />
          {selectedCount === 0 && (
            <span className="text-[10px] text-gray-400 px-1">
              {selectedConnectorCount} connector{selectedConnectorCount !== 1 ? "s" : ""}
            </span>
          )}
        </>
      )}

      {/* Export menu */}
      {stageRef && objects && connectors && boardTitle != null && (
        <>
          <div className="w-px h-6 bg-gray-200 mx-1" />
          <ExportMenu
            stageRef={stageRef}
            objects={objects}
            connectors={connectors}
            boardTitle={boardTitle}
          />
        </>
      )}
    </div>
  );
}
