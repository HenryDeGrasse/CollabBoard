import { useState, useRef, useEffect } from "react";
import { Download, Image, FileCode, FileJson } from "lucide-react";
import type Konva from "konva";
import type { BoardObject, Connector } from "../../types/board";
import { exportAsPNG, exportAsSVG, exportAsJSON } from "../../utils/export";

interface ExportMenuProps {
  stageRef: React.RefObject<Konva.Stage | null>;
  objects: Record<string, BoardObject>;
  connectors: Record<string, Connector>;
  boardTitle: string;
}

const exportOptions = [
  { id: "png", label: "Export as PNG", icon: <Image size={14} /> },
  { id: "svg", label: "Export as SVG", icon: <FileCode size={14} /> },
  { id: "json", label: "Export as JSON", icon: <FileJson size={14} /> },
] as const;

export function ExportMenu({ stageRef, objects, connectors, boardTitle }: ExportMenuProps) {
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

  const handleExport = (format: "png" | "svg" | "json") => {
    setOpen(false);
    const stage = stageRef.current;

    if (format === "json") {
      exportAsJSON(objects, connectors, boardTitle);
      return;
    }

    if (!stage) return;

    if (format === "png") {
      exportAsPNG(stage);
    } else {
      exportAsSVG(stage);
    }
  };

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1.5 px-2 py-1.5 rounded-lg hover:bg-gray-100 transition"
        title="Export board"
        data-testid="export-menu-button"
      >
        <Download size={18} className="text-gray-500" />
      </button>

      {open && (
        <div className="absolute bottom-full left-0 mb-1.5 bg-white rounded-lg shadow-xl border border-gray-200 p-1.5 z-[60] min-w-[160px]">
          <p className="text-[10px] text-gray-400 uppercase tracking-wider px-2 mb-1">Export</p>
          {exportOptions.map((opt) => (
            <button
              key={opt.id}
              onClick={() => handleExport(opt.id)}
              className="w-full flex items-center gap-2 px-2 py-1.5 rounded hover:bg-gray-50 transition text-sm text-gray-700"
              data-testid={`export-${opt.id}`}
            >
              {opt.icon}
              {opt.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
