import { useState } from "react";
import { HelpCircle, X } from "lucide-react";

const shortcuts = [
  { section: "Tools" },
  { key: "V", desc: "Select tool" },
  { key: "S", desc: "Sticky Note tool" },
  { key: "R", desc: "Rectangle tool" },
  { key: "C", desc: "Circle tool" },
  { key: "A", desc: "Arrow / Connector tool" },
  { key: "L", desc: "Line tool" },
  { key: "F", desc: "Frame tool" },
  { section: "Actions" },
  { key: "Delete / Backspace", desc: "Delete selected objects" },
  { key: "Escape", desc: "Deselect all / cancel tool" },
  { key: "Ctrl + Z", desc: "Undo" },
  { key: "Ctrl + Shift + Z", desc: "Redo" },
  { key: "Ctrl + C", desc: "Copy selected" },
  { key: "Ctrl + V", desc: "Paste" },
  { key: "Ctrl + D", desc: "Duplicate selected" },
  { section: "Navigation" },
  { key: "Space + Drag", desc: "Pan canvas" },
  { key: "Right-click + Drag", desc: "Pan canvas" },
  { key: "Scroll", desc: "Zoom in / out" },
  { section: "Editing" },
  { key: "Double-click", desc: "Edit text on object" },
  { key: "Click away", desc: "Finish editing" },
] as const;

export function HelpPanel() {
  const [open, setOpen] = useState(false);

  return (
    <>
      {/* Help button */}
      <button
        onClick={() => setOpen(true)}
        className="fixed bottom-4 left-4 z-50 ml-20 w-8 h-8 bg-white/80 backdrop-blur rounded-lg shadow-sm border border-gray-200 flex items-center justify-center hover:bg-white transition text-gray-500 hover:text-gray-700"
        title="Keyboard shortcuts (?)"
      >
        <HelpCircle size={16} />
      </button>

      {/* Modal overlay */}
      {open && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/30 backdrop-blur-sm"
          onClick={() => setOpen(false)}
        >
          <div
            className="bg-white rounded-2xl shadow-2xl w-full max-w-md mx-4 overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
              <h2 className="text-lg font-semibold text-gray-900">Keyboard Shortcuts</h2>
              <button
                onClick={() => setOpen(false)}
                className="p-1 rounded-lg hover:bg-gray-100 transition text-gray-400 hover:text-gray-600"
              >
                <X size={18} />
              </button>
            </div>

            {/* Shortcuts list */}
            <div className="px-6 py-4 max-h-[60vh] overflow-y-auto space-y-1">
              {shortcuts.map((item, i) => {
                if ("section" in item && !("key" in item)) {
                  return (
                    <div key={i} className={`text-xs font-semibold uppercase tracking-wider text-gray-400 ${i > 0 ? "pt-4 pb-1" : "pb-1"}`}>
                      {item.section}
                    </div>
                  );
                }
                if ("key" in item && "desc" in item) {
                  return (
                    <div key={i} className="flex items-center justify-between py-1.5">
                      <span className="text-sm text-gray-600">{item.desc}</span>
                      <kbd className="inline-flex items-center px-2 py-0.5 text-xs font-mono bg-gray-100 border border-gray-200 rounded text-gray-600">
                        {item.key}
                      </kbd>
                    </div>
                  );
                }
                return null;
              })}
            </div>

            {/* Footer */}
            <div className="px-6 py-3 bg-gray-50 border-t border-gray-100 text-center">
              <p className="text-xs text-gray-400">Press <kbd className="px-1 py-0.5 bg-gray-200 rounded text-xs">?</kbd> to toggle this panel</p>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
